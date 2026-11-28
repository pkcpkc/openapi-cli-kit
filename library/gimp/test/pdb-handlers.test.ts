import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gimpHandlers } from '../handlers.ts';
import { fakeGimp, hasGimp, runGimpCli } from './support.ts';

describe('GIMP PDB handlers', () => {
it.skipIf(!hasGimp)('queries the installed PDB', async () => {
    const result = await runGimpCli(gimpHandlers(), ['pdb', 'list', '--limit', '1', '--json']);
    expect(result.code).toBe(0);
    expect(result.json().total).toBeGreaterThan(0);
    expect(result.json().procedures).toHaveLength(1);
  });
  it('searches names with pagination using the live PDB query', async () => {
    const { fake, calls } = fakeGimp((script) => {
      expect(script).toContain('pdb.query_procedures("file.*"');
      expect(script).toContain('"procedures": names[10:15]');
      return { total: 17, offset: 10, limit: 5, procedures: ['file-png-load'] };
    });
    const { code, json } = await runGimpCli(gimpHandlers(fake), ['pdb', 'list', '--match', 'file.*', '--offset', '10', '--limit', '5', '--json']);
    expect(code).toBe(0);
    expect(json()).toEqual({ total: 17, offset: 10, limit: 5, procedures: ['file-png-load'] });
    expect(calls[0]).toContain('--batch-interpreter=python-fu-eval');
    expect(calls[0]).toContain('--no-interface');
  });
  it('inspects exact procedure metadata and handles a missing local procedure', async () => {
    const details = { name: 'file-png-load', blurb: 'Load PNG', help: 'Load a PNG file', helpId: 'gimp-file-png-load', arguments: [{ name: 'file', type: 'GFile' }], returns: [] };
    let lookups = 0;
    const { fake } = fakeGimp(() => (++lookups === 1 ? details : { _status: 404, _error: 'No installed GIMP procedure named file-png-load' }));
    const found = await runGimpCli(gimpHandlers(fake), ['pdb', 'info', 'file-png-load', '--json']);
    expect(found.code).toBe(0);
    expect(found.json()).toEqual(details);
    const missing = await runGimpCli(gimpHandlers(fake), ['pdb', 'info', 'file-png-load']);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/No installed GIMP procedure named file-png-load/);
  });
  it('exports the local PDB dump to --out', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-test-'));
    const { fake } = fakeGimp((script) => {
      const dump = /Gio\.File\.new_for_path\(("(?:[^"\\]|\\.)*")\)/.exec(script);
      return { file: dump ? JSON.parse(dump[1]) : '' };
    });
    const out = path.join(directory, 'nested', 'pdb.txt');
    const result = await runGimpCli(gimpHandlers(fake), ['pdb', 'dump', '-o', out, '--json']);
    expect(result.code).toBe(0);
    expect(result.json()).toEqual({ file: out });
    expect(fs.readFileSync(out, 'utf8')).toBe('local PDB dump');
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
