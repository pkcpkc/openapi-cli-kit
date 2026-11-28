import type { CliSpec, JsonSchema, Method, Operation, Parameter, ResponseObject } from './runner/spec.ts';

/**
 * A compact way to write a CLI's OpenAPI document (`build.ts` writes it as `<binary>.openapi.json`): each command once, the
 * conventions of SPEC.md filled in (paths from the words and arguments, `--json`, the standard outcomes and their
 * exit codes, `--no-wait`/`--timeout` for commands that queue work).
 */

export interface ArgDef {
  name: string;
  description: string;
  schema?: JsonSchema;
  optional?: boolean;
}

export interface FlagDef {
  name: `--${string}`;
  short?: `-${string}`;
  description: string;
  schema?: JsonSchema;
  required?: boolean;
}

export interface OpDef {
  id: string;
  /** The subcommand's words, e.g. `item get`. */
  cmd: string;
  method: Method;
  summary: string;
  description?: string;
  args?: ArgDef[];
  flags?: FlagDef[];
  /** Stdin. */
  body?: { mediaType: string; description: string; required?: boolean; schema?: JsonSchema };
  /** The 200 outcome: what is printed (`schema` a component name or a schema; `list`: an array of those). */
  result: { description: string; schema?: JsonSchema | string; list?: boolean };
  /**
   * The command queues background tasks: it waits for them (`--timeout`, this default) unless `--no-wait`, which answers
   * with the tasks at once (202).
   */
  job?: { timeout: string };
  /** The command takes long but answers itself (a model call): `--timeout`, this default. */
  slow?: { timeout: string };
  /** Refused while something holds it, or it would lose something (409). Default: any command that changes state. */
  conflicts?: boolean;
  /** Fails when what its arguments name is not found (404). Default: when it has arguments. */
  missing?: boolean;
}

export interface CliProfileDef {
  summary: string;
  description: string;
  examples: string[];
  /** Operation IDs from the full CLI definition that belong in this focused contract. */
  operationIds: string[];
}

/** The standard outcomes a CLI shares (`STANDARD_RESPONSES`), by name. */
export type StandardResponse = 'Accepted' | 'Usage' | 'NotFound' | 'Conflict' | 'Unavailable' | 'Failed' | 'Timeout';

export interface CliDef {
  binary: string;
  version: string;
  minVersion?: string;
  summary: string;
  description: string;
  examples: string[];
  /** Component schemas; one named like a standard one (`Error`, `Task`, `Queued`) replaces it. */
  schemas: Record<string, JsonSchema>;
  /** Optional focused OpenAPI views, generated from the same operations as the full CLI. */
  profiles?: Record<string, CliProfileDef>;
  /** The standard outcomes in this CLI's words (what is not running, how to wait for queued tasks). */
  responses?: Partial<Record<StandardResponse, string>>;
  ops: OpDef[];
}

/** The outcomes every CLI shares, with their exit codes (SPEC.md). */
const outcome = (description: string, exit: number, schema: string, stream: 'stdout' | 'stderr' = 'stderr'): ResponseObject => ({
  description,
  'x-cli-exit-code': exit,
  'x-cli-stream': stream,
  ...(stream === 'stdout' ? { 'x-cli-when-flag': '--json' } : {}),
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
});

/** The outcomes every CLI shares, with their exit codes (SPEC.md). */
export const STANDARD_RESPONSES: Record<StandardResponse, ResponseObject> = {
  Accepted: outcome('Queued (--no-wait): the tasks keep running in the background', 0, 'Queued', 'stdout'),
  Usage: outcome('Usage error: a missing or invalid argument, flag or stdin', 1, 'Error'),
  NotFound: outcome('Not found: what the arguments name does not exist', 2, 'Error'),
  Conflict: outcome('Conflict: something holds it, or it is still in use (the hint says what to do)', 3, 'Error'),
  Unavailable: outcome('Unavailable: a service or tool it needs is not running or not installed', 4, 'Error'),
  Failed: outcome('Failed: the task or the tool it runs failed', 5, 'Error'),
  Timeout: outcome('Timed out: --timeout ran out; queued tasks keep running', 124, 'Error'),
};

/** The schemas every CLI shares: the error, a background task and a list of queued ones. */
export const STANDARD_SCHEMAS: Record<string, JsonSchema> = {
  Error: {
    type: 'object',
    required: ['error', 'status'],
    properties: {
      error: { type: 'string', description: 'What went wrong' },
      status: { type: 'integer', description: 'The HTTP-style status: 400, 404, 409, 500, 503 or 504' },
      hint: { type: 'string', description: 'What to do next' },
      tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' }, description: 'The tasks still running (504) or failed (500)' },
    },
  },
  Task: {
    type: 'object',
    required: ['id', 'title', 'status'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      status: { enum: ['queued', 'running', 'done', 'failed', 'aborted'] },
      statusText: { type: 'string' },
      progress: { type: ['number', 'null'], description: '0-1 while it runs and reports it' },
    },
  },
  Queued: {
    type: 'object',
    required: ['tasks'],
    properties: { tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } } },
  },
};

const ref = (name: string) => ({ $ref: `#/components/responses/${name}` });
const schemaOf = (s: JsonSchema | string | undefined): JsonSchema | undefined => (typeof s === 'string' ? { $ref: `#/components/schemas/${s}` } : s);

const JSON_FLAG: Parameter = { name: '--json', in: 'query', description: 'Print the result as JSON (errors too, on stderr)', schema: { type: 'boolean', default: false } };

function operation(op: OpDef): { path: string; operation: Operation } {
  const words = op.cmd.split(' ');
  const args = op.args ?? [];
  const path = '/' + [...words, ...args.map((a) => `{${a.name}}`)].join('/');
  const parameters: Parameter[] = [
    ...args.map((a, i): Parameter => ({ name: a.name, in: 'path', required: true, description: a.description, schema: a.schema ?? { type: 'string' }, 'x-cli-position': i })),
    ...(op.flags ?? []).map((f): Parameter => ({ name: f.name, in: 'query', description: f.description, ...(f.required ? { required: true } : {}), schema: f.schema ?? { type: 'string' }, ...(f.short ? { 'x-cli-short': f.short } : {}) })),
    ...(op.job
      ? [
          { name: '--no-wait', in: 'query', description: 'Answer at once with the queued tasks instead of waiting for them', schema: { type: 'boolean', default: false } } as Parameter,
          { name: '--timeout', in: 'query', 'x-cli-short': '-t', description: 'How long to wait for the tasks', schema: { type: 'string', format: 'duration', default: op.job.timeout } } as Parameter,
        ]
      : op.slow
        ? [{ name: '--timeout', in: 'query', 'x-cli-short': '-t', description: 'How long to wait for the answer', schema: { type: 'string', format: 'duration', default: op.slow.timeout } } as Parameter]
        : []),
    JSON_FLAG,
  ];
  const item = schemaOf(op.result.schema) ?? { type: 'object' };
  const responses: Operation['responses'] = {
    200: { description: op.result.description, 'x-cli-exit-code': 0, 'x-cli-stream': 'stdout', 'x-cli-when-flag': '--json', content: { 'application/json': { schema: op.result.list ? { type: 'array', items: item } : item } } },
  };
  if (op.job) responses[202] = ref('Accepted');
  responses[400] = ref('Usage');
  if (op.missing ?? args.length > 0) responses[404] = ref('NotFound');
  if (op.conflicts ?? op.method !== 'get') responses[409] = ref('Conflict');
  if (op.job || op.slow) responses[500] = ref('Failed');
  responses[503] = ref('Unavailable');
  if (op.job || op.slow) responses[504] = ref('Timeout');
  return {
    path,
    operation: {
      operationId: op.id,
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      parameters,
      ...(op.body ? { requestBody: { description: op.body.description, required: op.body.required ?? false, content: { [op.body.mediaType]: { schema: op.body.schema ?? (op.body.mediaType.includes('json') ? { type: 'object' } : { type: 'string' }) } } } } : {}),
      responses,
    },
  };
}

function referencedComponents(value: unknown): Set<string> {
  const refs = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key === '$ref' && typeof child === 'string' && child.startsWith('#/components/')) refs.add(child);
        else visit(child);
      }
    }
  };
  visit(value);
  return refs;
}

function profileComponents(paths: CliSpec['paths'], schemas: Record<string, JsonSchema>, responses: Record<string, ResponseObject>) {
  const pending = [...referencedComponents(paths)];
  const includedSchemas: Record<string, JsonSchema> = {};
  const includedResponses: Record<string, ResponseObject> = {};

  while (pending.length) {
    const ref = pending.pop()!;
    const match = /^#\/components\/(schemas|responses)\/([^/]+)$/.exec(ref);
    if (!match) continue;
    const [, kind, name] = match;
    if (kind === 'schemas' && schemas[name] && !includedSchemas[name]) {
      includedSchemas[name] = schemas[name];
      pending.push(...referencedComponents(schemas[name]));
    } else if (kind === 'responses' && responses[name] && !includedResponses[name]) {
      includedResponses[name] = responses[name];
      pending.push(...referencedComponents(responses[name]));
    }
  }
  return { schemas: includedSchemas, responses: includedResponses };
}

/** The OpenAPI 3.1 document of a CLI, or one focused profile of it. */
export function buildSpec(def: CliDef, profileName?: string): CliSpec {
  for (const [name, profile] of Object.entries(def.profiles ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${def.binary}: invalid OpenAPI profile name ${name}`);
    if (!profile.summary || !profile.description || !Array.isArray(profile.examples) || !profile.examples.length || !Array.isArray(profile.operationIds) || !profile.operationIds.length) {
      throw new Error(`${def.binary}: OpenAPI profile ${name} needs a summary, description, examples, and operations`);
    }
    const missingIds = profile.operationIds.filter((id) => !def.ops.some((op) => op.id === id));
    if (missingIds.length) throw new Error(`${def.binary}: OpenAPI profile ${name} names unknown operations: ${missingIds.join(', ')}`);
    if (new Set(profile.operationIds).size !== profile.operationIds.length) {
      throw new Error(`${def.binary}: OpenAPI profile ${name} lists an operation more than once`);
    }
  }
  const profile = profileName === undefined ? undefined : def.profiles?.[profileName];
  if (profileName !== undefined && !profile) throw new Error(`${def.binary}: unknown OpenAPI profile ${profileName}`);
  const ops = profile ? def.ops.filter((op) => profile.operationIds.includes(op.id)) : def.ops;
  if (profile && !ops.length) throw new Error(`${def.binary}: OpenAPI profile ${profileName} has no operations`);

  const paths: CliSpec['paths'] = {};
  for (const op of ops) {
    const { path, operation: o } = operation(op);
    if (paths[path]?.[op.method]) throw new Error(`${def.binary}: two commands on ${op.method.toUpperCase()} ${path}`);
    paths[path] = { ...paths[path], [op.method]: o };
  }
  const allResponses = Object.fromEntries(Object.entries(STANDARD_RESPONSES).map(([name, response]) => [
    name,
    { ...response, description: def.responses?.[name as StandardResponse] ?? response.description },
  ]));
  const allSchemas = { ...STANDARD_SCHEMAS, ...def.schemas };
  const components = profile ? profileComponents(paths, allSchemas, allResponses) : { schemas: allSchemas, responses: allResponses };
  return {
    openapi: '3.1.0',
    info: {
      title: profileName !== undefined ? `${def.binary} (${profileName})` : def.binary,
      version: def.version,
      summary: profile?.summary ?? def.summary,
      description: profile?.description ?? def.description,
    },
    'x-cli': { binary: def.binary, ...(def.minVersion ? { min_version: def.minVersion } : {}), examples: profile?.examples ?? def.examples },
    paths,
    components,
  };
}
