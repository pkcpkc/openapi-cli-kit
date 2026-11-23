import { usageLine } from './runner/argv.ts';
import { isReadOnly, typeLabel } from './runner/help.ts';
import { commands, deref, type CliSpec, type ResponseObject } from './runner/spec.ts';

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/**
 * Every command of a CLI as markdown (a skill's `references/commands.md`): usage, what it does, arguments, flags, stdin
 * and outcomes. `source` names where it is generated from, for the do-not-edit note.
 */
export function referenceText(spec: CliSpec, source = `${spec['x-cli'].binary}.openapi.json`): string {
  const { binary } = spec['x-cli'];
  const cmds = commands(spec);
  const lines = [
    `# ${binary} commands`,
    '',
    `<!-- Generated from ${source}: do not edit by hand. -->`,
    '',
    `${spec.info.summary} Every command takes \`--json\` (the result as JSON on stdout, errors as JSON on stderr) and \`--help\`.`,
    '',
    `Reads only (safe to run without asking): ${cmds.filter(isReadOnly).map((c) => `\`${[binary, ...c.words].join(' ')}\``).join(', ') || 'none'}.`,
    '',
  ];
  for (const c of cmds) {
    lines.push(`## \`${usageLine(c, binary)}\``, '', `${c.op.summary}${isReadOnly(c) ? ' *(reads only)*' : ''}`);
    if (c.op.description) lines.push('', c.op.description.trim());
    const params = [...c.positionals, ...c.flags.filter((f) => f.name !== '--json')];
    if (params.length) {
      lines.push('', '| Argument | Type | Meaning |', '| --- | --- | --- |');
      for (const p of params) {
        const name = p.in === 'path' ? `\`<${p.name}>\`` : `\`${[p['x-cli-short'], p.name].filter(Boolean).join(', ')}\``;
        const notes = [p.schema.default !== undefined ? `default \`${JSON.stringify(p.schema.default)}\`` : '', p.required && p.in === 'query' ? 'required' : '', p.schema.type === 'array' ? 'repeatable' : ''].filter(Boolean).join(', ');
        lines.push(`| ${name} | ${cell(typeLabel(p.schema))} | ${cell(p.description ?? '')}${notes ? ` (${notes})` : ''} |`);
      }
    }
    if (c.op.requestBody) {
      const type = Object.keys(c.op.requestBody.content)[0];
      lines.push('', `Stdin (\`${type}\`, ${c.op.requestBody.required ? 'required' : 'optional'}): ${c.op.requestBody.description ?? ''}`);
    }
    const outcomes = Object.values(c.op.responses).map((r) => deref<ResponseObject>(spec, r));
    lines.push('', `Exit codes: ${[...new Set(outcomes.map((r) => r['x-cli-exit-code']))].sort((a, b) => a - b).join(', ')}. Prints: ${outcomes[0].description}.`, '');
  }
  return lines.join('\n');
}
