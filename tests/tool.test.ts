import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildSpec, cliProblems } from '../src/index.ts';
import { toolHandlers } from '../src/tool/handlers.ts';
import { toolEntry } from '../src/tool/main.ts';
import { toolCli } from '../src/tool/spec.ts';
import { run, tempDir } from './helpers.ts';

const spec = buildSpec(toolCli);
const tool = (argv: string[], cwd?: string) => run(spec, toolHandlers(), argv, cwd);

/** A project folder with a package.json. */
function project(pkg: Record<string, unknown> = { name: 'demo', dependencies: { 'openapi-cli-kit': '^0.1.0', tsx: '^4' } }) {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

describe('ocli', () => {
  it('is written as built, its handlers and skill in step (npm run specs)', () => {
    expect(cliProblems(toolEntry())).toEqual([]);
  });

  it('lists the library', async () => {
    const { code, json } = await tool(['list', '--json']);
    expect(code).toBe(0);
    expect(json()).toContainEqual(expect.objectContaining({ name: 'magick', binary: 'magick-cli', requires: ['magick'] }));
  });

  it('adds an item: its code, spec, launcher and skill, and the launcher to package.json bin', async () => {
    const dir = project();
    const { code, json } = await tool(['add', 'magick', '--json'], dir);
    expect(code).toBe(0);
    const added = json();
    expect(added).toMatchObject({ item: 'magick', binary: 'magick-cli', bin: 'cli/magick-cli/bin.mjs' });
    for (const file of ['cli/magick-cli/spec.ts', 'cli/magick-cli/handlers.ts', 'cli/magick-cli/magick-cli.openapi.json', 'cli/magick-cli/bin.mjs', '.agents/skills/magick-cli/SKILL.md', '.agents/skills/magick-cli/references/commands.md']) {
      expect(added.files).toContain(path.join(dir, file));
    }
    expect(fs.statSync(path.join(dir, 'cli/magick-cli/bin.mjs')).mode & 0o111).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).bin).toEqual({ 'magick-cli': 'cli/magick-cli/bin.mjs' });
    expect(added.next.filter((n: string) => n.startsWith('npm install'))).toEqual([]);
  });

  it('renames every mention of the binary with --as, into the folders given', async () => {
    const dir = project({ name: 'demo' });
    const { json } = await tool(['add', 'magick', '--as', 'img', '-d', 'tools', '--skills-dir', '.claude/skills', '--no-package', '--json'], dir);
    expect(json().next).toContain('npm install openapi-cli-kit tsx');
    const texts = ['tools/img/spec.ts', 'tools/img/handlers.ts', 'tools/img/img.openapi.json', 'tools/img/bin.mjs', '.claude/skills/img/SKILL.md', '.claude/skills/img/references/commands.md'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const text of texts) expect(text).not.toMatch(/magick-cli/);
    expect(JSON.parse(texts[2])['x-cli'].binary).toBe('img');
    expect(texts[4]).toMatch(/^---\nname: img\n/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).bin).toBeUndefined();
  });

  it('refuses to overwrite without --force, an unknown item and a bad name', async () => {
    const dir = project();
    await tool(['add', 'magick'], dir);
    const again = await tool(['add', 'magick'], dir);
    expect([again.code, again.err]).toEqual([3, expect.stringMatching(/--force/)]);
    expect((await tool(['add', 'magick', '--force'], dir)).code).toBe(0);
    expect((await tool(['add', 'nope'], dir)).code).toBe(2);
    expect((await tool(['add', 'magick', '--as', 'Bad_Name'], dir)).code).toBe(1);
  });

  it('lints a document: fine, or each problem (exit 1)', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify(spec));
    expect((await tool(['lint', path.join(dir, 'ok.json')])).code).toBe(0);
    const broken = { ...spec, paths: { ...spec.paths, '/{id}/get': { get: { operationId: 'x', summary: 'x', responses: { 200: { description: 'ok' } } } } } };
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(broken));
    const { code, err } = await tool(['lint', path.join(dir, 'bad.json'), '--json']);
    expect(code).toBe(1);
    expect(JSON.parse(err).problems).toEqual(expect.arrayContaining([expect.stringMatching(/words must come before/), expect.stringMatching(/needs x-cli-exit-code/)]));
    expect((await tool(['lint', path.join(dir, 'missing.json')])).code).toBe(2);
  });

  it('writes the command reference of a document', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec));
    const { out } = await tool(['reference', path.join(dir, 'spec.json')]);
    expect(out).toMatch(/^# ocli commands\n/);
    expect(out).toContain('## `ocli add <item> [flags]`');
  });
});
