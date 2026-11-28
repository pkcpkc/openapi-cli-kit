import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpec, cliProblems, lintSpec, writeCli, type CliDef, type Handlers } from '../src/index.ts';
import { commandLine, scaffoldItem } from '../scripts/scaffold.ts';
import { tempDir } from './helpers.ts';

/** A copy of the library's registry to scaffold into. */
function root() {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'library'));
  fs.copyFileSync(fileURLToPath(new URL('../library/index.ts', import.meta.url)), path.join(dir, 'library', 'index.ts'));
  return dir;
}

const FIXTURE = { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))] };

/** The scaffolded item, written and checked as a project would. */
async function check(dir: string, name: string, binary: string) {
  const item = path.join(dir, 'library', name);
  const { cli } = (await import(path.join(item, 'spec.ts'))) as { cli: CliDef };
  const { handlers } = (await import(path.join(item, 'handlers.ts'))) as { handlers: () => Handlers };
  const entry = { def: cli, handlers, specFile: path.join(dir, 'out', `${binary}.openapi.json`), skillDir: item };
  writeCli(entry);
  return { cli, problems: cliProblems(entry) };
}

describe('npm run new-item', () => {
  it('scaffolds an item by the scheme, registers it, and refuses to overwrite', async () => {
    const dir = root();
    const written = await scaffoldItem(dir, { name: 'ffmpeg-tools', summary: 'Clips with ffmpeg' });
    expect(written.map((f) => path.relative(dir, f)).sort()).toEqual(['library/ffmpeg-tools/SKILL.md', 'library/ffmpeg-tools/handlers.ts', 'library/ffmpeg-tools/item.ts', 'library/ffmpeg-tools/spec.ts', 'library/ffmpeg-tools/test/handlers.test.ts', 'library/index.ts']);
    const index = fs.readFileSync(path.join(dir, 'library', 'index.ts'), 'utf8');
    expect(index).toContain("import { ffmpegTools } from './ffmpeg-tools/item.ts';");
    expect(index).toMatch(/ITEMS: LibraryItem\[\] = \[imagemagick, (.+, )?ffmpegTools\]/);
    const { problems } = await check(dir, 'ffmpeg-tools', 'ffmpeg-tools-cli');
    expect(problems).toEqual([]);
    await expect(scaffoldItem(dir, { name: 'ffmpeg-tools' })).rejects.toThrow(/there already/);
    await expect(scaffoldItem(dir, { name: 'Bad_Name' })).rejects.toThrow(/lowercase/);
  });

  it('makes an item from an MCP server: one command per tool, the server and the mapping kept', async () => {
    const dir = root();
    await scaffoldItem(dir, { name: 'notes', mcp: FIXTURE });
    const spec = fs.readFileSync(path.join(dir, 'library', 'notes', 'spec.ts'), 'utf8');
    expect(spec).toContain('export const SERVER: McpServer');
    expect(spec).toContain('"tool": "createNote"');
    const { cli, problems } = await check(dir, 'notes', 'notes-cli');
    expect(problems).toEqual([]);
    expect(cli.ops.map((o) => o.cmd)).toEqual(['echo-text', 'create-note', 'fail']);
    expect(lintSpec(buildSpec(cli))).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'library', 'notes', 'item.ts'), 'utf8')).toContain(`"command": ${JSON.stringify(process.execPath)}`);
  });

  it('splits a command line with quotes', () => {
    expect(commandLine('npx -y "@scope/server name" --x')).toEqual({ command: 'npx', args: ['-y', '@scope/server name', '--x'] });
  });
});
