import { spawn, type ChildProcess } from 'node:child_process';
import { CliError } from './runner/errors.ts';
import type { Handlers } from './runner/run.ts';
import type { FlagDef, OpDef } from './dsl.ts';
import type { JsonSchema } from './runner/spec.ts';

/**
 * A small MCP client (the Model Context Protocol), without dependencies: enough to list a server's tools and call them,
 * over stdio (a command it starts) or Streamable HTTP (a URL). It backs the library items made from MCP servers
 * (`scripts/scaffold.ts --mcp-*`, `mcpHandlers()`): each CLI call connects, calls one tool and closes.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** Where an MCP server is. Strings may hold `${env:NAME}`, filled in from the environment when connecting. */
export type McpServer =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { url: string; headers?: Record<string, string> };

/** A tool as the server lists it. */
export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema & { properties?: Record<string, JsonSchema>; required?: string[] };
  outputSchema?: JsonSchema;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

/** A tool's answer. */
export interface McpToolResult {
  content: { type: string; text?: string; data?: string; mimeType?: string; [key: string]: unknown }[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

/** `${env:NAME}` in a string, filled in; a missing variable is a usage error (it names what to set). */
export function expandEnv(text: string, env: Record<string, string | undefined> = process.env): string {
  return text.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = env[name];
    if (value === undefined) throw new CliError(400, `${name} is not set`, `Set ${name} in the environment: the MCP server needs it`);
    return value;
  });
}

const expandAll = (record: Record<string, string> | undefined, env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(record ?? {}).map(([k, v]) => [k, expandEnv(v, env)]));

/** A connection to one MCP server: `connect()`, then `listTools()` and `callTool()`, then `close()`. */
export class McpClient {
  private nextId = 1;
  private transport: Transport | null = null;
  serverInfo: { name: string; version?: string } | null = null;
  instructions: string | undefined;

  constructor(
    private readonly server: McpServer,
    private readonly options: { env?: Record<string, string | undefined>; timeoutMs?: number; clientName?: string } = {}
  ) {}

  async connect(): Promise<this> {
    const env = this.options.env ?? process.env;
    this.transport = 'url' in this.server ? new HttpTransport(expandEnv(this.server.url, env), expandAll(this.server.headers, env)) : new StdioTransport(this.server, env);
    const init = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.options.clientName ?? 'openapi-cli-kit', version: '0.1.0' },
    });
    this.serverInfo = init.serverInfo ?? null;
    this.instructions = init.instructions;
    if (this.transport instanceof HttpTransport) this.transport.protocolVersion = init.protocolVersion ?? MCP_PROTOCOL_VERSION;
    await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return this;
  }

  /** Every tool, across pages. */
  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {});
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return (await this.request('tools/call', { name, arguments: args })) as McpToolResult;
  }

  async close(): Promise<void> {
    await this.transport?.close();
    this.transport = null;
  }

  private async request(method: string, params: unknown): Promise<any> {
    if (!this.transport) throw new Error('Not connected: call connect() first');
    const id = this.nextId++;
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CliError(504, `The MCP server did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`, 'Raise --timeout')), timeoutMs);
    });
    try {
      const reply = await Promise.race([this.transport.request({ jsonrpc: '2.0', id, method, params }), timeout]);
      if (reply.error) throw new CliError(reply.error.code === -32602 ? 400 : 500, `${method}: ${reply.error.message}`);
      return reply.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Connects, runs `use`, and closes again, whatever happens. */
export async function withMcp<T>(server: McpServer, use: (client: McpClient) => Promise<T>, options?: ConstructorParameters<typeof McpClient>[1]): Promise<T> {
  const client = new McpClient(server, options);
  try {
    await client.connect();
    return await use(client);
  } finally {
    await client.close();
  }
}

interface Transport {
  request(message: JsonRpcMessage): Promise<JsonRpcMessage>;
  send(message: JsonRpcMessage): Promise<void>;
  close(): Promise<void>;
}

/** stdio: newline-delimited JSON-RPC to a process it starts. */
class StdioTransport implements Transport {
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number | string, (m: JsonRpcMessage) => void>();
  private buffer = '';
  private stderr = '';
  private failure: CliError | null = null;

  constructor(server: Extract<McpServer, { command: string }>, env: Record<string, string | undefined>) {
    const command = expandEnv(server.command, env);
    this.child = spawn(command, (server.args ?? []).map((a) => expandEnv(a, env)), {
      cwd: server.cwd,
      env: { ...env, ...expandAll(server.env, env) } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout!.setEncoding('utf8').on('data', (chunk: string) => this.receive(chunk));
    this.child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-4000)));
    const fail = (error: CliError) => {
      this.failure = error;
      for (const resolve of this.waiting.values()) resolve({ jsonrpc: '2.0', error: { code: -1, message: error.message } });
      this.waiting.clear();
    };
    this.child.on('error', (err: NodeJS.ErrnoException) =>
      fail(new CliError(503, err.code === 'ENOENT' ? `Cannot start the MCP server: no ${command}` : `Cannot start the MCP server: ${err.message}`, `Install ${command}, or change the server command in spec.ts`))
    );
    this.child.on('exit', (code) => fail(new CliError(503, `The MCP server exited (${code})${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').pop()}` : ''}`, 'Check that it runs on its own, with the environment it needs')));
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // a log line on stdout
      }
      if (message.id !== undefined && message.method) {
        // A request from the server (ping, sampling, …): answer ping, refuse the rest
        void this.send(message.method === 'ping' ? { jsonrpc: '2.0', id: message.id, result: {} } : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `${message.method} is not supported by this client` } });
      } else if (message.id !== undefined) {
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
      }
    }
  }

  request(message: JsonRpcMessage): Promise<JsonRpcMessage> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting.set(message.id!, (reply) => (this.failure ? reject(this.failure) : resolve(reply)));
      this.send(message).catch(reject);
    });
  }

  send(message: JsonRpcMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.child.stdin!.write(JSON.stringify(message) + '\n', (err) => (err ? reject(this.failure ?? new CliError(503, `The MCP server closed its input: ${err.message}`)) : resolve()));
    });
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.killed) return;
    this.child.removeAllListeners('exit');
    this.child.stdin!.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => (this.child.kill('SIGTERM'), resolve()), 2000);
      this.child.once('exit', () => (clearTimeout(timer), resolve()));
    });
  }
}

/** Streamable HTTP: each message a POST; the answer JSON, or an event stream that carries it. */
class HttpTransport implements Transport {
  private session: string | undefined;
  protocolVersion: string | undefined;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>
  ) {}

  private async post(message: JsonRpcMessage): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
          ...(this.protocolVersion ? { 'MCP-Protocol-Version': this.protocolVersion } : {}),
          ...this.headers,
        },
        body: JSON.stringify(message),
      });
    } catch (err) {
      throw new CliError(503, `Cannot reach the MCP server at ${this.url}: ${(err as Error).message}`, 'Check the URL and that the server runs');
    }
    if (response.status === 401 || response.status === 403) throw new CliError(503, `The MCP server refused the credentials (${response.status})`, 'Check the headers in spec.ts and the variables they name');
    if (!response.ok && response.status !== 202) throw new CliError(response.status === 404 ? 404 : 503, `The MCP server answered ${response.status} ${response.statusText}`);
    this.session = response.headers.get('mcp-session-id') ?? this.session;
    return response;
  }

  async request(message: JsonRpcMessage): Promise<JsonRpcMessage> {
    const response = await this.post(message);
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('text/event-stream')) return (await response.json()) as JsonRpcMessage;
    // Server-sent events: the reply is the data of the event with this id
    const text = response.body ? response.body.pipeThrough(new TextDecoderStream()) : null;
    let buffer = '';
    for await (const chunk of text ?? []) {
      buffer += chunk;
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const data = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data) as JsonRpcMessage;
        if (parsed.id === message.id && !parsed.method) return parsed;
      }
    }
    throw new CliError(500, `The MCP server's event stream ended without answering ${message.method}`);
  }

  async send(message: JsonRpcMessage): Promise<void> {
    await this.post(message);
  }

  async close(): Promise<void> {
    if (!this.session) return;
    await fetch(this.url, { method: 'DELETE', headers: { 'Mcp-Session-Id': this.session, ...this.headers } }).catch(() => undefined);
  }
}

// ---- MCP tools as CLI commands ----

/** How a command maps back to its tool: the tool's name and, by flag key, the argument and whether it is JSON. */
export interface McpCommand {
  tool: string;
  args: Record<string, { name: string; json?: boolean }>;
}

/** Flags the runner keeps for itself (or the DSL adds). */
const RESERVED = new Set(['json', 'help', 'timeout', 'no-wait', 'version', 'input']);

/** `getIssue`, `get_issue`, `get.issue` → `get-issue`. */
export const kebab = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'tool';

/** A JSON schema the runner can take as a flag value, and whether the value is JSON text (objects, nested arrays). */
function flagSchema(schema: JsonSchema): { schema: JsonSchema; json: boolean } {
  const type = Array.isArray(schema.type) ? (schema.type as string[]).find((t) => t !== 'null') : schema.type;
  // No default: the server applies its own, so a flag not given is an argument not sent
  const base = {};
  if (schema.enum && (schema.enum as unknown[]).every((v) => typeof v === 'string' || typeof v === 'number')) return { schema: { ...base, enum: schema.enum }, json: false };
  switch (type) {
    case 'string':
      return { schema: { type: 'string', ...base, ...(typeof schema.pattern === 'string' ? { pattern: schema.pattern } : {}) }, json: false };
    case 'integer':
    case 'number':
      return { schema: { type, ...base, ...(typeof schema.minimum === 'number' ? { minimum: schema.minimum } : {}), ...(typeof schema.maximum === 'number' ? { maximum: schema.maximum } : {}) }, json: false };
    case 'boolean':
      return { schema: { type: 'boolean', ...base }, json: false };
    case 'array': {
      const items = (schema.items ?? {}) as JsonSchema;
      if (['string', 'integer', 'number'].includes(items.type as string)) return { schema: { type: 'array', items: flagSchema(items).schema }, json: false };
      return { schema: { type: 'string' }, json: true };
    }
    default:
      return { schema: { type: 'string' }, json: true };
  }
}

/** The first sentence of a description, for a one-line summary. */
const firstSentence = (text: string | undefined, fallback: string) => {
  const line = (text ?? '').trim().split(/\n/)[0];
  const m = /^(.{1,160}?[.!?])(\s|$)/.exec(line);
  return (m ? m[1] : line.slice(0, 160)) || fallback;
};

/**
 * MCP tools as CLI commands, one word each (the tool name in kebab-case): each input property a flag (its type kept;
 * objects and arrays of objects as JSON text), required ones required, and `--input` for the whole arguments object as
 * JSON (stdin works too). Read-only tools are `get`, others `post`. Returns the ops and how each maps back to its tool.
 */
export function mcpCommands(tools: McpTool[], timeout = '5m'): { ops: OpDef[]; commands: Record<string, McpCommand> } {
  const ops: OpDef[] = [];
  const commands: Record<string, McpCommand> = {};
  for (const tool of tools) {
    let id = kebab(tool.name);
    while (commands[id]) id += '-x';
    const props = tool.inputSchema?.properties ?? {};
    const required = new Set(tool.inputSchema?.required ?? []);
    const args: McpCommand['args'] = {};
    const flags: FlagDef[] = [];
    for (const [name, schema] of Object.entries(props)) {
      let key = kebab(name);
      if (RESERVED.has(key) || args[key]) key = `${key}-arg`;
      const { schema: s, json } = flagSchema(schema as JsonSchema);
      args[key] = { name, ...(json ? { json: true } : {}) };
      const fallback = (schema as JsonSchema).default;
      const description = firstSentence((schema as JsonSchema).description as string | undefined, name) + (json ? ' (JSON)' : '') + (fallback !== undefined ? `; the server's default: ${JSON.stringify(fallback)}` : '');
      // A required argument can also come in --input or on stdin, so the runner does not insist on it
      flags.push({ name: `--${key}`, description: required.has(name) ? `${description} (needed)` : description, schema: s });
    }
    flags.push({ name: '--input', description: 'All the arguments as one JSON object (stdin works too); flags given override its fields' });
    commands[id] = { tool: tool.name, args };
    const readOnly = tool.annotations?.readOnlyHint === true;
    ops.push({
      id,
      cmd: id,
      method: readOnly ? 'get' : 'post',
      summary: firstSentence(tool.description ?? tool.annotations?.title ?? tool.title, `The ${tool.name} tool`),
      ...(tool.description && tool.description.trim() !== firstSentence(tool.description, '') ? { description: tool.description.trim() } : {}),
      flags,
      body: { mediaType: 'application/json', description: 'The arguments as a JSON object' },
      slow: { timeout },
      conflicts: false,
      missing: false,
      result: { description: 'The tool result: content (text, images, …), structuredContent when it has one' },
    });
  }
  return { ops, commands };
}

/** The arguments of a tool call from a command's flags, `--input` and stdin; a required one missing is a usage error. */
export function mcpArguments(command: McpCommand, flags: Record<string, unknown>, body: unknown, required: string[] = []): Record<string, unknown> {
  const parse = (text: string, what: string) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new CliError(400, `${what} is not valid JSON`);
    }
  };
  const input = typeof flags.input === 'string' ? parse(flags.input, '--input') : {};
  const args: Record<string, unknown> = { ...(body && typeof body === 'object' ? body : {}), ...input };
  for (const [key, { name, json }] of Object.entries(command.args)) {
    if (flags[key] === undefined) continue;
    args[name] = json && typeof flags[key] === 'string' ? parse(flags[key] as string, `--${key}`) : flags[key];
  }
  const missing = required.filter((r) => args[r] === undefined);
  if (missing.length) throw new CliError(400, `Missing ${missing.map((m) => `--${Object.entries(command.args).find(([, a]) => a.name === m)?.[0] ?? m}`).join(', ')}`, 'Give it as a flag, in --input, or as JSON on stdin');
  return args;
}

/** A tool result's text, for reading without --json. */
export function mcpResultText(result: McpToolResult): string {
  const parts = result.content.map((c) => (c.type === 'text' ? (c.text ?? '') : c.type === 'image' || c.type === 'audio' ? `[${c.type} ${c.mimeType ?? ''}, ${Math.round(((c.data ?? '').length * 3) / 4)} bytes: use --json]` : c.type === 'resource_link' ? `[${String(c.uri ?? c.name ?? 'resource')}]` : JSON.stringify(c)));
  if (!parts.length && result.structuredContent !== undefined) return JSON.stringify(result.structuredContent, null, 2) + '\n';
  return parts.join('\n').replace(/\n?$/, '\n');
}

/**
 * The handlers of a CLI made from an MCP server: each command connects, calls its tool and closes. A tool's error is
 * a failure (exit 5) with its text; a server that cannot be reached is unavailable (exit 4).
 */
export function mcpHandlers(server: McpServer, commands: Record<string, McpCommand>, requiredOf: Record<string, string[]> = {}, connect = (s: McpServer, timeoutMs?: number) => new McpClient(s, { timeoutMs }).connect()): Handlers {
  return Object.fromEntries(
    Object.entries(commands).map(([id, command]) => [
      id,
      async ({ flags, body }) => {
        const args = mcpArguments(command, flags, body, requiredOf[id]);
        const client = await connect(server, flags.timeout as number | undefined);
        try {
          const result = await client.callTool(command.tool, args);
          if (result.isError) throw new CliError(500, mcpResultText(result).trim() || `${command.tool} failed`, undefined, { content: result.content });
          return { body: result, text: mcpResultText(result) };
        } finally {
          await client.close();
        }
      },
    ])
  );
}
