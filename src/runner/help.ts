import { usageLine } from './argv.ts';
import { commands, commandsUnder, deref, type CliSpec, type Command, type JsonSchema, type Parameter, type ResponseObject } from './spec.ts';

const pad = (s: string, n: number) => (s.length >= n ? `${s}  ` : s + ' '.repeat(n - s.length));

/** A schema as one short word: `string`, `integer`, `a|b|c`, `duration`, `path`, `string[]`. */
export function typeLabel(schema: JsonSchema): string {
  if (schema.type === 'array') return `${typeLabel(schema.items ?? { type: 'string' })}…`;
  if (schema.enum) return schema.enum.join('|');
  return schema.format === 'duration' || schema.format === 'path' ? schema.format : (schema.type ?? 'value');
}

/** Whether a command only reads (`get`): safe to run without asking. */
export const isReadOnly = (c: Pick<Command, 'method'>): boolean => c.method === 'get';

/** The examples of `x-cli.examples` that use the command. */
const examplesOf = (spec: CliSpec, words: string[]) => (spec['x-cli'].examples ?? []).filter((e) => new RegExp(`(^|[|;&]\\s*)${spec['x-cli'].binary} ${words.join(' ')}( |$)`).test(e));

/** The exit codes the spec's responses declare, each with what it means (first description wins). */
function exitCodes(spec: CliSpec, cmds: Command[]): [number, string][] {
  const codes = new Map<number, string>();
  for (const c of cmds) {
    for (const raw of Object.values(c.op.responses)) {
      const r = deref<ResponseObject>(spec, raw);
      if (!codes.has(r['x-cli-exit-code'])) codes.set(r['x-cli-exit-code'], r.description);
    }
  }
  return [...codes].sort((a, b) => a[0] - b[0]);
}

/** The overview: every command, grouped, with the output conventions, exit codes and examples. */
export function overviewHelp(spec: CliSpec, prefix: string[] = []): string {
  const { binary } = spec['x-cli'];
  const cmds = prefix.length ? commandsUnder(spec, prefix) : commands(spec);
  const width = Math.min(48, Math.max(...cmds.map((c) => usageLine(c).length)) + 2);
  const lines = [`${binary} ${spec.info.version}: ${spec.info.summary ?? spec.info.title}`, ''];
  if (!prefix.length && spec.info.description) lines.push(spec.info.description.trim(), '');
  lines.push(`Usage: ${binary} <command> [arguments] [flags]    (${binary} <command> --help for one command)`, '', 'Commands (· reads only, * changes state):');
  let group: string | null = null;
  for (const c of cmds) {
    const key = c.words.length > 1 ? c.words[0] : '';
    if (key !== group && !prefix.length) {
      group = key;
      lines.push('');
    }
    lines.push(`  ${isReadOnly(c) ? '·' : '*'} ${pad(usageLine(c), width)}${c.op.summary}`);
  }
  if (!prefix.length) {
    lines.push('', 'Output: plain text; add --json for the result as JSON on stdout. Errors go to stderr (as JSON with --json).', '', 'Exit codes:');
    for (const [code, what] of exitCodes(spec, cmds)) lines.push(`  ${pad(String(code), 5)}${what}`);
    const examples = spec['x-cli'].examples ?? [];
    if (examples.length) lines.push('', 'Examples:', ...examples.map((e) => `  ${e}`));
  }
  return lines.join('\n') + '\n';
}

const paramLine = (p: Parameter, width: number) => {
  const name = p.in === 'path' ? `<${p.name}>` : [p['x-cli-short'], p.name].filter(Boolean).join(', ');
  const extra = [p.schema.default !== undefined ? `default ${JSON.stringify(p.schema.default)}` : '', p.required && p.in === 'query' ? 'required' : '', p.schema.type === 'array' ? 'repeatable' : '']
    .filter(Boolean)
    .join(', ');
  return `  ${pad(name, width)}${pad(typeLabel(p.schema), 22)}${p.description ?? ''}${extra ? ` (${extra})` : ''}`;
};

/** One command: usage, what it does, its arguments, flags, stdin, output, exit codes and examples. */
export function commandHelp(spec: CliSpec, c: Command): string {
  const { binary } = spec['x-cli'];
  const lines = [`Usage: ${usageLine(c, binary)}`, '', c.op.summary + (isReadOnly(c) ? ' (reads only)' : ' (changes state)')];
  if (c.op.description) lines.push('', c.op.description.trim());
  const width = Math.max(14, ...[...c.positionals, ...c.flags].map((p) => (p.in === 'path' ? p.name.length + 2 : p.name.length + 4))) + 2;
  if (c.positionals.length) lines.push('', 'Arguments:', ...c.positionals.map((p) => paramLine(p, width)));
  if (c.flags.length) lines.push('', 'Flags:', ...c.flags.map((p) => paramLine(p, width)));
  if (c.op.requestBody) {
    const type = Object.keys(c.op.requestBody.content)[0];
    lines.push('', `Stdin (${type}${c.op.requestBody.required ? ', required' : ', optional'}): ${c.op.requestBody.description ?? ''}`);
  }
  lines.push('', 'Outcomes:');
  for (const [status, raw] of Object.entries(c.op.responses)) {
    const r = deref<ResponseObject>(spec, raw);
    const where = `${r['x-cli-stream'] ?? 'stdout'}${r['x-cli-when-flag'] ? ` (JSON with ${r['x-cli-when-flag']})` : ''}`;
    lines.push(`  exit ${pad(String(r['x-cli-exit-code']), 5)}${pad(where, 26)}${r.description}${status === 'default' ? '' : ''}`);
  }
  const examples = examplesOf(spec, c.words);
  if (examples.length) lines.push('', 'Examples:', ...examples.map((e) => `  ${e}`));
  return lines.join('\n') + '\n';
}
