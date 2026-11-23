import fs from 'node:fs';

/**
 * An OpenAPI 3.1 document that describes a CLI with the `x-cli-*` extensions (SPEC.md): paths are
 * subcommands (literal segments the words, templated ones the positional arguments), query parameters the flags, the
 * request body stdin, each response an outcome with its stream and exit code.
 */

export type JsonSchema = Record<string, unknown> & {
  type?: string;
  enum?: readonly unknown[];
  default?: unknown;
  format?: string;
  items?: JsonSchema;
  $ref?: string;
};

export interface Parameter {
  name: string;
  in: 'path' | 'query';
  description?: string;
  required?: boolean;
  schema: JsonSchema;
  'x-cli-position'?: number;
  'x-cli-short'?: string;
}

export interface ResponseObject {
  description: string;
  'x-cli-exit-code': number;
  'x-cli-stream'?: 'stdout' | 'stderr';
  'x-cli-when-flag'?: string;
  content?: Record<string, { schema?: JsonSchema }>;
  $ref?: string;
}

export interface Operation {
  operationId: string;
  summary: string;
  description?: string;
  parameters?: (Parameter | { $ref: string })[];
  requestBody?: { description?: string; required?: boolean; content: Record<string, { schema?: JsonSchema }> };
  responses: Record<string, ResponseObject | { $ref: string }>;
}

export const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Method = (typeof METHODS)[number];

export interface CliSpec {
  openapi: string;
  info: { title: string; version: string; summary?: string; description?: string };
  'x-cli': { binary: string; min_version?: string; examples?: string[] };
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components?: { schemas?: Record<string, JsonSchema>; responses?: Record<string, ResponseObject>; parameters?: Record<string, Parameter> };
}

/** One subcommand: its words, its positional arguments (in order), its flags and the operation behind it. */
export interface Command {
  words: string[];
  method: Method;
  path: string;
  op: Operation;
  positionals: Parameter[];
  flags: Parameter[];
}

/** Reads a CLI's OpenAPI document (`<binary>.openapi.json`). */
export function loadSpec(file: string | URL): CliSpec {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CliSpec;
}

/** Resolves a local `$ref` (`#/components/...`). */
export function deref<T>(spec: CliSpec, value: T | { $ref: string }): T {
  const ref = (value as { $ref?: string }).$ref;
  if (!ref) return value as T;
  if (!ref.startsWith('#/')) throw new Error(`Only local $refs are supported: ${ref}`);
  const target = ref
    .slice(2)
    .split('/')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], spec);
  if (target === undefined) throw new Error(`Unresolved $ref ${ref}`);
  return deref(spec, target as T | { $ref: string });
}

/** A path's segments: literal words and `{name}` slots. */
export function pathSegments(p: string): { words: string[]; slots: string[] } {
  const parts = p.split('/').filter(Boolean);
  return { words: parts.filter((s) => !s.startsWith('{')), slots: parts.filter((s) => s.startsWith('{')).map((s) => s.slice(1, -1)) };
}

/** Every subcommand of the spec. */
export function commands(spec: CliSpec): Command[] {
  const list: Command[] = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = (op.parameters ?? []).map((x) => deref<Parameter>(spec, x));
      const positionals = params.filter((x) => x.in === 'path').sort((a, b) => (a['x-cli-position'] ?? 0) - (b['x-cli-position'] ?? 0));
      list.push({ words: pathSegments(p).words, method, path: p, op, positionals, flags: params.filter((x) => x.in === 'query') });
    }
  }
  return list;
}

/** The command whose words start `argv` (the longest such), and the arguments after them. */
export function findCommand(spec: CliSpec, argv: string[]): { command: Command; rest: string[] } | null {
  let best: Command | null = null;
  for (const c of commands(spec)) {
    if (c.words.length > argv.length || !c.words.every((w, i) => argv[i] === w)) continue;
    if (!best || c.words.length > best.words.length) best = c;
  }
  return best ? { command: best, rest: argv.slice(best.words.length) } : null;
}

/** The commands whose words start with `prefix` (a group, e.g. `item`). */
export const commandsUnder = (spec: CliSpec, prefix: string[]): Command[] =>
  commands(spec).filter((c) => prefix.every((w, i) => c.words[i] === w));

/** A response of an operation by its status (`default` if not declared), resolved. */
export function responseFor(spec: CliSpec, op: Operation, status: number): ResponseObject | undefined {
  const raw = op.responses[String(status)] ?? op.responses.default;
  return raw ? deref<ResponseObject>(spec, raw) : undefined;
}
