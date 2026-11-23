import { parseArgs, usageLine } from './argv.ts';
import { CliError } from './errors.ts';
import { commandHelp, overviewHelp } from './help.ts';
import { commandsUnder, findCommand, responseFor, type CliSpec, type Command } from './spec.ts';

/** Where a command reads and writes: injectable, so tests run commands without a terminal. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Stdin's text; `null` when nothing is piped in (a terminal, or nothing arrives while it is optional). */
  readStdin: (required: boolean) => Promise<string | null>;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface HandlerInput {
  args: Record<string, any>;
  flags: Record<string, any>;
  /** Stdin, parsed as the request body's media type (JSON, or text); undefined when none was piped in. */
  body?: any;
  io: Io;
  command: Command;
}

/** A command's outcome: a status of its spec's responses (200 when omitted), the result, and its plain-text form. */
export interface HandlerResult {
  status?: number;
  body: unknown;
  /** The result for a person (without `--json`); default: the result as indented key: value lines. */
  text?: string;
}

export type Handler = (input: HandlerInput) => Promise<HandlerResult>;
export type Handlers = Record<string, Handler>;

/** A result as indented `key: value` lines, for reading without `--json`. */
export function plainText(value: unknown, indent = ''): string {
  if (value === null || value === undefined) return `${indent}-\n`;
  if (typeof value !== 'object') return `${indent}${String(value)}\n`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}(none)\n`;
    return value.map((v) => (v !== null && typeof v === 'object' ? `${indent}-\n${plainText(v, indent + '  ')}` : `${indent}- ${String(v)}\n`)).join('');
  }
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (v !== null && typeof v === 'object' && !(Array.isArray(v) && v.every((x) => typeof x !== 'object'))) return `${indent}${k}:\n${plainText(v, indent + '  ')}`;
      const text = Array.isArray(v) ? v.join(', ') : String(v);
      return text.includes('\n') ? `${indent}${k}: |\n${text.replace(/^/gm, `${indent}  `)}\n` : `${indent}${k}: ${text}\n`;
    })
    .join('');
}

/** The exit code of a status by the operation's responses; one it does not declare: 1 for a usage-type failure, else 5. */
function exitCode(spec: CliSpec, command: Command | null, status: number): number {
  const declared = command ? responseFor(spec, command.op, status)?.['x-cli-exit-code'] : spec.components?.responses?.[String(status)]?.['x-cli-exit-code'];
  return declared ?? (status >= 200 && status < 300 ? 0 : status < 500 ? 1 : 5);
}

/** Writes a failure to stderr: JSON with `--json`, else `error:` and `hint:` lines. */
function reportError(io: Io, err: CliError, json: boolean): void {
  if (json) io.stderr(JSON.stringify({ error: err.message, status: err.status, ...(err.hint ? { hint: err.hint } : {}), ...(err.detail ?? {}) }) + '\n');
  else io.stderr(`error: ${err.message}\n${err.hint ? `hint: ${err.hint}\n` : ''}`);
}

/** Parses a body by its media type. */
function parseBody(text: string, mediaType: string): unknown {
  if (!mediaType.includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(400, `Stdin is not valid JSON (${mediaType})`);
  }
}

/**
 * Runs a CLI: finds the command its spec describes for `argv`, parses its arguments and stdin, runs its handler and writes
 * the outcome where the spec's response says, as JSON with its `x-cli-when-flag`. Returns the exit code.
 */
export async function runCli(spec: CliSpec, handlers: Handlers, argv: string[], io: Io): Promise<number> {
  const json = argv.includes('--json');
  if (argv[0] === '--version') {
    io.stdout(`${spec.info.version}\n`);
    return 0;
  }
  const found = findCommand(spec, argv.filter((a) => a !== '--help' && a !== '-h'));
  const wantsHelp = argv.includes('--help') || argv.includes('-h');
  if (!found) {
    // No command: the overview, or the group's commands (`tool item`)
    const prefix = argv.filter((a) => !a.startsWith('-'));
    const group = commandsUnder(spec, prefix);
    if (!prefix.length || group.length) {
      io.stdout(overviewHelp(spec, prefix.length ? prefix : []));
      return 0;
    }
    reportError(io, new CliError(400, `Unknown command "${prefix.join(' ')}"`, `${spec['x-cli'].binary} --help lists the commands`), json);
    return exitCode(spec, null, 400);
  }
  const { command, rest } = found;
  if (wantsHelp) {
    io.stdout(commandHelp(spec, command));
    return 0;
  }
  const handler = handlers[command.op.operationId];
  try {
    if (!handler) throw new CliError(500, `No handler for ${command.op.operationId}`);
    const { args, flags } = parseArgs(command, rest, io.cwd);
    let body: unknown;
    const requestBody = command.op.requestBody;
    if (requestBody) {
      const text = await io.readStdin(Boolean(requestBody.required));
      if (text === null || !text.trim()) {
        if (requestBody.required) throw new CliError(400, `Pipe ${requestBody.description ?? "the input"} into stdin (usage: … | ${usageLine(command, spec['x-cli'].binary)})`);
      } else body = parseBody(text, Object.keys(requestBody.content)[0]);
    }
    const result = await handler({ args, flags, body, io, command });
    const status = result.status ?? 200;
    const response = responseFor(spec, command.op, status);
    const write = response?.['x-cli-stream'] === 'stderr' ? io.stderr : io.stdout;
    const asJson = response?.['x-cli-when-flag'] ? Boolean(flags[response['x-cli-when-flag'].replace(/^-+/, '')]) : json;
    // With --json, stdout is always one JSON document (a list too)
    if (asJson) write(JSON.stringify(result.body) + '\n');
    else write(result.text ?? plainText(result.body));
    return exitCode(spec, command, status);
  } catch (err) {
    const failure = err instanceof CliError ? err : new CliError(500, err instanceof Error ? err.message : String(err));
    reportError(io, failure, json);
    return exitCode(spec, command, failure.status);
  }
}
