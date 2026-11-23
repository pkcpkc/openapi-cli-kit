import fs from 'node:fs';
import { CliError } from '../runner/errors.ts';
import { lintSpec } from '../runner/lint.ts';
import type { Handlers } from '../runner/run.ts';
import type { CliSpec } from '../runner/spec.ts';
import { addItem, LIBRARY } from '../library.ts';
import { referenceText } from '../reference.ts';
import { table } from './table.ts';

/** A CLI document from a file: 404 when missing, 400 when not JSON. */
function readSpec(file: string): CliSpec {
  if (!fs.existsSync(file)) throw new CliError(404, `No such file: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CliSpec;
  } catch {
    throw new CliError(400, `${file} is not JSON`);
  }
}

/** The handlers of `ocli` (`spec.ts`). */
export function toolHandlers(): Handlers {
  return {
    list: async () => {
      const rows = LIBRARY.map((i) => ({ name: i.name, binary: i.binary, summary: i.summary, requires: i.requires.map((r) => r.command) }));
      return { body: rows, text: table(rows, ['name', 'binary', 'summary']) };
    },
    add: async ({ args, flags, io }) => {
      const result = addItem(args.item, { cwd: io.cwd, as: flags.as, dir: flags.dir, skillsDir: flags['skills-dir'], force: flags.force, noPackage: flags['no-package'] });
      const text = [`Added ${result.binary} (${result.item}):`, ...result.files.map((f) => `  ${f}`), ...(result.bin ? [`package.json bin: ${result.binary} -> ${result.bin}`] : []), ...(result.next.length ? ['Next:', ...result.next.map((n) => `  ${n}`)] : [])];
      return { body: result, text: text.join('\n') + '\n' };
    },
    lint: async ({ args }) => {
      const problems = (() => {
        try {
          return lintSpec(readSpec(args.spec));
        } catch (err) {
          if (err instanceof CliError) throw err;
          return [`not a CLI document: ${(err as Error).message}`];
        }
      })();
      if (problems.length) throw new CliError(400, `${problems.length} problem${problems.length === 1 ? '' : 's'} in ${args.spec}:\n  ${problems.join('\n  ')}`, 'Fix them as SPEC.md says', { problems });
      return { body: { file: args.spec, problems: [] }, text: `${args.spec}: fine\n` };
    },
    reference: async ({ args }) => {
      const markdown = referenceText(readSpec(args.spec));
      return { body: { markdown }, text: markdown };
    },
  };
}
