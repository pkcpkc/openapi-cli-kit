import path from 'node:path';
import type { Command, JsonSchema, Parameter } from './spec.ts';
import { CliError } from './errors.ts';

/** What a command was called with: its positional arguments and flags by name (without the dashes), typed by the spec. */
export interface ParsedArgs {
  args: Record<string, unknown>;
  flags: Record<string, unknown>;
}

const flagKey = (p: Parameter) => p.name.replace(/^-+/, '');

/** `30s`, `15m`, `2h`, `500ms` as milliseconds. */
export function parseDuration(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] as 'ms' | 's' | 'm' | 'h']);
}

/** A value as the parameter's schema types it; a usage error (400) when it does not fit. */
export function coerce(param: Parameter, raw: string, cwd: string): unknown {
  const schema: JsonSchema = param.schema.type === 'array' ? (param.schema.items ?? { type: 'string' }) : param.schema;
  const name = param.in === 'query' ? param.name : `<${param.name}>`;
  let value: unknown = raw;
  switch (schema.type) {
    case 'integer':
    case 'number': {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n) || (schema.type === 'integer' && !Number.isInteger(n))) throw new CliError(400, `${name} must be ${schema.type === 'integer' ? 'a whole number' : 'a number'}, not "${raw}"`);
      if (typeof schema.minimum === 'number' && n < schema.minimum) throw new CliError(400, `${name} must be at least ${schema.minimum}`);
      if (typeof schema.maximum === 'number' && n > schema.maximum) throw new CliError(400, `${name} must be at most ${schema.maximum}`);
      value = n;
      break;
    }
    case 'boolean':
      if (!['true', 'false'].includes(raw)) throw new CliError(400, `${name} is true or false, not "${raw}"`);
      value = raw === 'true';
      break;
    default:
      if (schema.format === 'duration') {
        const ms = parseDuration(raw);
        if (ms === null) throw new CliError(400, `${name} must be a duration like 30s, 15m or 2h, not "${raw}"`);
        value = ms;
      } else if (schema.format === 'path') value = path.resolve(cwd, raw);
      else if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(raw)) throw new CliError(400, `${name} "${raw}" does not fit ${param.description ?? schema.pattern}`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new CliError(400, `${name} must be one of ${schema.enum.join(', ')}, not "${raw}"`);
  return value;
}

/**
 * Parses the arguments after a command's words: `--name value`, `--name=value`, a boolean `--name`, `-s value` (its short
 * flag), repeated array flags, positionals in order, and everything after `--` as positionals. Defaults fill the flags
 * not given; a missing required one, or an unknown flag, is a usage error.
 */
export function parseArgs(command: Command, argv: string[], cwd = process.cwd()): ParsedArgs {
  const byName = new Map(command.flags.map((f) => [f.name, f]));
  const byShort = new Map(command.flags.filter((f) => f['x-cli-short']).map((f) => [f['x-cli-short']!, f]));
  const flags: Record<string, unknown> = {};
  const positional: string[] = [];
  let rawOnly = false;

  const set = (param: Parameter, raw: string) => {
    const value = coerce(param, raw, cwd);
    const key = flagKey(param);
    if (param.schema.type === 'array') flags[key] = [...((flags[key] as unknown[]) ?? []), value];
    else flags[key] = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (rawOnly || token === '-' || !token.startsWith('-') || /^-\d/.test(token)) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      rawOnly = true;
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : token;
    const param = name.startsWith('--') ? byName.get(name) : byShort.get(name);
    if (!param) throw new CliError(400, `Unknown flag ${name} for "${command.words.join(' ')}" (see --help)`);
    if (param.schema.type === 'boolean' && eq < 0) {
      flags[flagKey(param)] = true;
      continue;
    }
    const raw = eq > 0 ? token.slice(eq + 1) : argv[++i];
    if (raw === undefined) throw new CliError(400, `${param.name} needs a value`);
    set(param, raw);
  }

  if (positional.length > command.positionals.length) throw new CliError(400, `Too many arguments: ${positional.slice(command.positionals.length).join(' ')} (usage: ${usageLine(command)})`);
  const args: Record<string, unknown> = {};
  command.positionals.forEach((p, i) => {
    if (positional[i] === undefined) {
      if (p.required !== false) throw new CliError(400, `Missing <${p.name}> (usage: ${usageLine(command)})`);
      return;
    }
    args[p.name] = coerce(p, positional[i], cwd);
  });
  for (const f of command.flags) {
    const key = flagKey(f);
    if (flags[key] !== undefined) continue;
    if (f.required) throw new CliError(400, `${f.name} is required`);
    if (f.schema.default !== undefined) flags[key] = f.schema.type === 'string' && f.schema.format === 'duration' ? parseDuration(String(f.schema.default)) : f.schema.default;
  }
  return { args, flags };
}

/** `tool item get <id> [flags]` */
export const usageLine = (command: Command, binary = ''): string =>
  [binary, ...command.words, ...command.positionals.map((p) => (p.required === false ? `[<${p.name}>]` : `<${p.name}>`)), command.flags.length ? '[flags]' : '']
    .filter(Boolean)
    .join(' ');
