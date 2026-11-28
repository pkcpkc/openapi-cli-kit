import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildSpec, cliProblems, lintSpec, skillCalls, writeCli, type CliDef, type CliEntry } from '../src/index.ts';
import { tempDir } from './helpers.ts';

const def: CliDef = {
  binary: 'tool',
  version: '1.0.0',
  summary: 'A test tool',
  description: 'For the project tests.',
  examples: ['tool item get a1 --json'],
  schemas: { Task: { type: 'object', properties: { id: { type: 'string' }, owner: { type: 'string' } } } },
  responses: { Unavailable: 'Unavailable: the tool server is not running (start it)' },
  ops: [
    { id: 'get', cmd: 'item get', method: 'get', summary: 'One item', args: [{ name: 'id', description: 'Its id' }], flags: [{ name: '--full', description: 'All of it', schema: { type: 'boolean' } }], result: { description: 'The item' } },
    { id: 'run', cmd: 'item run', method: 'post', summary: 'Run it', args: [{ name: 'id', description: 'Its id' }], job: { timeout: '5m' }, result: { description: 'Done' } },
  ],
};

const SKILL = `---\nname: tool\ndescription: ${'Works with items: gets them and runs them, waiting for the runs, for the tests of the project helpers.'}\n---\n\n# tool\n\n\`\`\`bash\ntool item get a1 --full --json | jq .\n\`\`\`\n`;

function entry(dir: string, d: CliDef = def): CliEntry {
  return { def: d, handlers: () => ({ get: async () => ({ body: {} }), run: async () => ({ body: {} }) }), specFile: path.join(dir, 'tool.openapi.json'), skillDir: path.join(dir, 'skill') };
}

describe('a project CLI', () => {
  it('lets a CLI word the standard outcomes and replace the standard schemas', () => {
    const spec = buildSpec(def);
    expect(spec.components?.responses?.Unavailable).toMatchObject({ description: 'Unavailable: the tool server is not running (start it)', 'x-cli-exit-code': 4 });
    expect(spec.components?.responses?.Usage?.description).toMatch(/^Usage error/);
    expect(spec.components?.schemas?.Task).toEqual(def.schemas.Task);
    expect(spec.paths['/item/run/{id}'].post?.responses).toHaveProperty('202');
  });

  it('builds a focused profile with only its operations and referenced schemas', () => {
    const profiled: CliDef = {
      ...def,
      profiles: {
        read: {
          summary: 'Read one item',
          description: 'A focused read-only contract.',
          examples: ['tool item get a1 --json'],
          operationIds: ['get'],
        },
      },
    };
    const spec = buildSpec(profiled, 'read');
    expect(Object.keys(spec.paths)).toEqual(['/item/get/{id}']);
    expect(spec.info.title).toBe('tool (read)');
    expect(Object.keys(spec.components?.schemas ?? {}).sort()).toEqual(['Error', 'Task']);
    expect(lintSpec(spec)).toEqual([]);
  });

  it('writes focused profile schemas and references alongside the full CLI', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'skill'));
    fs.writeFileSync(path.join(dir, 'skill', 'SKILL.md'), SKILL);
    const profiled: CliDef = {
      ...def,
      profiles: {
        read: {
          summary: 'Read one item',
          description: 'A focused read-only contract.',
          examples: ['tool item get a1 --json'],
          operationIds: ['get'],
        },
      },
    };
    const profiledEntry = entry(dir, profiled);
    const written = writeCli(profiledEntry).map((file) => path.relative(dir, file));
    expect(written).toContain(path.join('tool.read.openapi.json'));
    expect(written).toContain(path.join('skill', 'references', 'profiles.md'));
    expect(written).toContain(path.join('skill', 'references', 'profiles', 'read.openapi.json'));
    expect(written).toContain(path.join('skill', 'references', 'profiles', 'read.commands.md'));
    expect(cliProblems(profiledEntry)).toEqual([]);
  });

  it('is in step once written, with a skill whose examples parse', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'skill'));
    fs.writeFileSync(path.join(dir, 'skill', 'SKILL.md'), SKILL);
    expect(writeCli(entry(dir)).map((f) => path.relative(dir, f))).toEqual(['tool.openapi.json', path.join('skill', 'references', 'commands.md')]);
    expect(cliProblems(entry(dir))).toEqual([]);
  });

  it('says what is out of step', () => {
    const dir = tempDir();
    expect(cliProblems(entry(dir))[0]).toMatch(/is missing/);
    fs.mkdirSync(path.join(dir, 'skill'));
    fs.writeFileSync(path.join(dir, 'skill', 'SKILL.md'), SKILL.replace('--full', '--fast').replace('name: tool', 'name: other'));
    writeCli(entry(dir));
    const changed: CliDef = { ...def, summary: 'Changed' };
    const problems = cliProblems({ ...entry(dir, changed), handlers: () => ({ get: async () => ({ body: {} }), extra: async () => ({ body: {} }) }) });
    expect(problems).toEqual([
      expect.stringMatching(/not as built/),
      'command run has no handler',
      'handler extra has no command',
      expect.stringMatching(/needs name: tool/),
      expect.stringMatching(/not as generated/),
      expect.stringMatching(/Unknown flag --fast/),
    ]);
  });

  it('refuses to write a spec that does not lint', () => {
    const bad: CliDef = { ...def, ops: [...def.ops, { ...def.ops[0], id: 'again' }] };
    expect(() => writeCli(entry(tempDir(), bad))).toThrow(/two commands/);
  });

  it('finds the calls of its binary in a skill', () => {
    expect(skillCalls('```bash\ntool item get a # one\nother x\ntool item run b | jq . \n```\n', 'tool')).toEqual(['tool item get a', 'tool item run b']);
  });
});
