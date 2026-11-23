import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { addItem, LIBRARY, packageRoot } from '../src/library.ts';
import { buildSpec, cliProblems, lintSpec, type CliDef, type Handlers } from '../src/index.ts';
import { tempDir } from './helpers.ts';

describe.each(LIBRARY.map((i) => [i.name, i] as const))('the library item %s', (name, item) => {
  it('has its files, a skill and a spec that lints clean', () => {
    for (const file of [...item.files, 'SKILL.md']) expect(fs.existsSync(path.join(packageRoot(), 'library', name, file)), file).toBe(true);
    expect(lintSpec(buildSpec(item.def))).toEqual([]);
    expect(item.binary).toBe(item.def.binary);
  });

  it('works once added to a project, renamed too: spec current, a handler per command, the skill in step', async () => {
    for (const as of [undefined, 'renamed-cli']) {
      const dir = tempDir();
      const { binary } = addItem(name, { cwd: dir, as });
      const code = path.join(dir, 'cli', binary);
      const { cli } = (await import(path.join(code, 'spec.ts'))) as { cli: CliDef };
      const { handlers } = (await import(path.join(code, 'handlers.ts'))) as { handlers: () => Handlers };
      expect(cli.binary).toBe(binary);
      expect(cliProblems({ def: cli, handlers, specFile: path.join(code, `${binary}.openapi.json`), skillDir: path.join(dir, '.agents', 'skills', binary), source: path.join('cli', binary, `${binary}.openapi.json`) })).toEqual([]);
    }
  });
});
