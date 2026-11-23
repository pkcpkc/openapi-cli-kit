import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './runner/argv.ts';
import { lintSpec } from './runner/lint.ts';
import type { Handlers } from './runner/run.ts';
import { commands, findCommand, loadSpec, type CliSpec } from './runner/spec.ts';
import { buildSpec, type CliDef } from './dsl.ts';
import { referenceText } from './reference.ts';

/** A CLI of a project: its definition, its handlers, where its OpenAPI document lives and its agent skill. */
export interface CliEntry {
  def: CliDef;
  handlers: () => Handlers;
  /** Where `<binary>.openapi.json` is written (by `writeCli`) and read (by its launcher). */
  specFile: string;
  /** Its skill's folder: `SKILL.md` written by hand, `references/commands.md` written from the spec. */
  skillDir?: string;
  /** How the reference names where it comes from (its do-not-edit note). Default: the spec's file name. */
  source?: string;
}

/** A spec as it is written: indented JSON. */
export const specText = (def: CliDef): string => JSON.stringify(buildSpec(def), null, 2) + '\n';

const referenceFile = (entry: CliEntry) => path.join(entry.skillDir!, 'references', 'commands.md');

/** Writes a CLI's spec and its skill's command reference; refuses (throws) a spec that does not lint clean. Returns the files. */
export function writeCli(entry: CliEntry): string[] {
  const spec = buildSpec(entry.def);
  const problems = lintSpec(spec);
  if (problems.length) throw new Error(`${entry.def.binary}:\n  ${problems.join('\n  ')}`);
  fs.mkdirSync(path.dirname(entry.specFile), { recursive: true });
  fs.writeFileSync(entry.specFile, specText(entry.def), 'utf8');
  const written = [entry.specFile];
  if (entry.skillDir) {
    const file = referenceFile(entry);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, referenceText(spec, entry.source), 'utf8');
    written.push(file);
  }
  return written;
}

/** Shell words of a command line (quotes kept together, quotes removed). */
const words = (line: string) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

/** The calls of `binary` in a markdown's bash blocks: each line's part before a pipe, redirect or comment. */
export function skillCalls(markdown: string, binary: string): string[] {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap((m) => m[1].split('\n'))
    .map((l) => l.replace(/\s+#.*$/, '').split(/\s[|<>]\s?/)[0].trim())
    .filter((l) => l.split(' ')[0] === binary);
}

/**
 * What is out of step in a CLI (none: all is well), for a project's tests: its spec not written as built or not linting
 * clean, a command without a handler or a handler without a command, its skill's frontmatter, its reference not as
 * generated, or a call in the skill's examples that the CLI would refuse.
 */
export function cliProblems(entry: CliEntry): string[] {
  const { binary } = entry.def;
  const problems: string[] = [];
  const built = specText(entry.def);
  if (!fs.existsSync(entry.specFile)) return [`${entry.specFile} is missing: write it (writeCli)`];
  if (fs.readFileSync(entry.specFile, 'utf8') !== built) problems.push(`${entry.specFile} is not as built: write it again (writeCli)`);
  const spec = JSON.parse(built) as CliSpec;
  problems.push(...lintSpec(spec));
  const ids = commands(spec).map((c) => c.op.operationId);
  const handlers = entry.handlers();
  problems.push(...ids.filter((id) => !handlers[id]).map((id) => `command ${id} has no handler`));
  problems.push(...Object.keys(handlers).filter((id) => !ids.includes(id)).map((id) => `handler ${id} has no command`));
  if (entry.skillDir) {
    const skillFile = path.join(entry.skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) return [...problems, `${skillFile} is missing`];
    const skill = fs.readFileSync(skillFile, 'utf8');
    const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
    if (front?.[1] !== binary) problems.push(`${skillFile}: its frontmatter needs name: ${binary}`);
    if (!front?.[2] || front[2].length < 80) problems.push(`${skillFile}: its frontmatter needs a description (what it does and when to use it)`);
    const ref = referenceFile(entry);
    if (!fs.existsSync(ref) || fs.readFileSync(ref, 'utf8') !== referenceText(spec, entry.source)) problems.push(`${ref} is not as generated: write it again (writeCli)`);
    for (const call of skillCalls(skill, binary)) {
      const found = findCommand(spec, words(call).slice(1));
      if (!found) problems.push(`${skillFile}: calls no command: ${call}`);
      else {
        try {
          parseArgs(found.command, found.rest, '/');
        } catch (err) {
          problems.push(`${skillFile}: ${call}: ${(err as Error).message}`);
        }
      }
    }
  }
  return problems;
}

export { loadSpec };
