import extensions from '../../schema/openapi-cli-extensions.schema.json' with { type: 'json' };
import { METHODS, commands, deref, pathSegments, type CliSpec, type JsonSchema, type Parameter, type ResponseObject } from './spec.ts';

/** The extension schema (`schema/openapi-cli-extensions.schema.json`): each `x-cli*` field's own schema is one of its properties. */
export const EXTENSIONS_SCHEMA = extensions as unknown as { $id: string; properties: Record<string, JsonSchema> };

const loadExtensions = (): Record<string, JsonSchema> => EXTENSIONS_SCHEMA.properties;

/** The problems of `value` against a JSON schema (the keywords the extension schema uses). */
export function schemaProblems(value: unknown, schema: JsonSchema, at: string): string[] {
  const problems: string[] = [];
  const type = schema.type;
  const typeOk =
    type === undefined ||
    (type === 'integer' && Number.isInteger(value)) ||
    (type === 'number' && typeof value === 'number') ||
    (type === 'string' && typeof value === 'string') ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'array' && Array.isArray(value)) ||
    (type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value));
  if (!typeOk) return [`${at}: must be ${type === 'integer' ? 'an integer' : `a ${type}`}`];
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) problems.push(`${at}: must be at least ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) problems.push(`${at}: must be at most ${schema.maximum}`);
  }
  if (typeof value === 'string' && typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) problems.push(`${at}: must match ${schema.pattern}`);
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => problems.push(...schemaProblems(v, schema.items!, `${at}[${i}]`)));
  if (type === 'object' && value && typeof value === 'object') {
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in value)) problems.push(`${at}: needs ${key}`);
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const [key, sub] of Object.entries(props)) if (key in value) problems.push(...schemaProblems((value as Record<string, unknown>)[key], sub, `${at}.${key}`));
  }
  return problems;
}

/**
 * What is wrong with a CLI's spec (none: it is fine), by the rules of SPEC.md:
 * a valid OpenAPI 3.1 shape (every path parameter in its path, unique operation ids); literal words before the templated
 * segments, which are the positional arguments numbered 0..n by `x-cli-position` in path order; flags named `--name`; every
 * response with an exit code; words unique per command; and every `x-cli*` field valid by the extension schema.
 */
export function lintSpec(spec: CliSpec): string[] {
  const ext = loadExtensions();
  const problems: string[] = [];
  if (spec.openapi !== '3.1.0') problems.push('openapi must be 3.1.0');
  if (!spec.info?.title || !spec.info?.version) problems.push('info needs title and version');
  problems.push(...schemaProblems(spec['x-cli'], ext['x-cli'], 'x-cli'));

  const ids = new Set<string>();
  for (const [p, item] of Object.entries(spec.paths)) {
    const parts = p.split('/').filter(Boolean);
    const firstSlot = parts.findIndex((s) => s.startsWith('{'));
    if (firstSlot >= 0 && parts.slice(firstSlot).some((s) => !s.startsWith('{'))) problems.push(`${p}: the subcommand words must come before the {arguments}`);
    const { slots } = pathSegments(p);
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const at = `${method.toUpperCase()} ${p}`;
      if (!op.operationId) problems.push(`${at}: needs an operationId`);
      else if (ids.has(op.operationId)) problems.push(`${at}: operationId ${op.operationId} is used twice`);
      ids.add(op.operationId);
      const params = (op.parameters ?? []).map((x) => deref<Parameter>(spec, x));
      const positional = params.filter((x) => x.in === 'path');
      for (const slot of slots) if (!positional.some((x) => x.name === slot)) problems.push(`${at}: {${slot}} has no path parameter`);
      for (const x of positional) {
        if (x.required !== true) problems.push(`${at}: path parameter ${x.name} must be required`);
        if (!slots.includes(x.name)) problems.push(`${at}: path parameter ${x.name} is not in the path (OpenAPI 3.1 needs {${x.name}} in it)`);
        else if (x['x-cli-position'] !== slots.indexOf(x.name)) problems.push(`${at}: ${x.name} needs x-cli-position ${slots.indexOf(x.name)} (its place in the path)`);
      }
      for (const x of params) {
        if (x.in === 'query' && !/^--[a-z][a-z0-9-]*$/.test(x.name)) problems.push(`${at}: flag ${x.name} must be named --kebab-case`);
        for (const key of ['x-cli-position', 'x-cli-short'] as const) if (x[key] !== undefined) problems.push(...schemaProblems(x[key], ext[key], `${at} ${x.name} ${key}`));
        if (x.in === 'query' && x['x-cli-position'] !== undefined) problems.push(`${at}: flag ${x.name} cannot have a position`);
      }
      const shorts = params.flatMap((x) => (x['x-cli-short'] ? [x['x-cli-short']] : []));
      if (new Set(shorts).size !== shorts.length) problems.push(`${at}: a short flag is used twice`);
      if (!Object.keys(op.responses ?? {}).length) problems.push(`${at}: needs responses`);
      for (const [status, raw] of Object.entries(op.responses ?? {})) {
        const r = deref<ResponseObject>(spec, raw);
        if (r['x-cli-exit-code'] === undefined) problems.push(`${at} ${status}: needs x-cli-exit-code`);
        for (const key of ['x-cli-exit-code', 'x-cli-stream', 'x-cli-when-flag'] as const) if (r[key] !== undefined) problems.push(...schemaProblems(r[key], ext[key], `${at} ${status} ${key}`));
        const flag = r['x-cli-when-flag'];
        if (flag && !params.some((x) => x.name === flag)) problems.push(`${at} ${status}: x-cli-when-flag ${flag} is not one of its flags`);
        if (status.startsWith('2') && r['x-cli-exit-code'] !== 0) problems.push(`${at} ${status}: a success exits 0`);
        if (/^[45]/.test(status) && (r['x-cli-exit-code'] === 0 || r['x-cli-stream'] !== 'stderr')) problems.push(`${at} ${status}: a failure exits non-zero on stderr`);
      }
    }
  }
  const words = commands(spec).map((c) => c.words.join(' '));
  for (const w of new Set(words)) if (words.filter((x) => x === w).length > 1) problems.push(`"${w}" names two commands`);
  const binary = spec['x-cli'].binary;
  for (const example of spec['x-cli'].examples ?? []) {
    const call = example.split(/\s*[|;&]+\s*/).find((part) => part.startsWith(`${binary} `));
    if (!call) problems.push(`example does not call ${binary}: ${example}`);
    else if (!commands(spec).some((c) => [binary, ...c.words].every((w, i) => call.split(/\s+/)[i] === w))) problems.push(`example calls no command: ${example}`);
  }
  return problems;
}
