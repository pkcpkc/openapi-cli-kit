import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../../src/index.ts';
import { gimpRunner, resolveGimpBinary } from '../runtime.ts';
import { fakeGimp, runGimpCli } from './support.ts';
import { gimpHandlers } from '../handlers.ts';

describe('GIMP runtime', () => {
  it('finds and runs the GIMP executable inside a macOS app bundle', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-app-'));
    const app = path.join(home, 'Applications', 'GIMP 3.2.app');
    const binary = path.join(app, 'Contents', 'MacOS', 'gimp-3.2');
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(
      path.join(app, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist><dict><key>CFBundleExecutable</key><string>gimp-3.2</string></dict></plist>'
    );
    fs.writeFileSync(binary, `#!${process.execPath}\nprocess.stdout.write(process.argv.slice(2).join(" "));\n`, { mode: 0o755 });
    try {
      expect(resolveGimpBinary({ PATH: '', HOME: home }, 'darwin')).toBe(binary);
      expect(resolveGimpBinary({ PATH: '', HOME: home }, 'linux')).toBe('gimp');
      const { code, stdout } = await gimpRunner({ PATH: '', HOME: home }, 'darwin')(['--version']);
      expect([code, stdout]).toEqual([0, '--version']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
  it('rejects invalid regular expressions and reports a missing GIMP install', async () => {
    const { fake } = fakeGimp();
    const invalid = await runGimpCli(gimpHandlers(fake), ['pdb', 'list', '--match', '[']);
    expect(invalid.code).toBe(1);
    expect(invalid.err).toMatch(/valid regular expression/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-missing-'));
    const missing = gimpRunner({ GIMP_BINARY: path.join(dir, 'no-gimp') });
    await expect(missing(['--version'])).rejects.toMatchObject({ status: 503 });
    await expect(missing(['--version'])).rejects.toBeInstanceOf(CliError);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
