import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gimpHandlers } from '../handlers.ts';
import { fakeGimp, hasGimp, runGimpCli } from './support.ts';

describe('GIMP script handler', () => {
  it('runs a Python script inside GIMP and captures print output and a JSON result', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-script-'));
    const scriptFile = path.join(directory, 'task.py');
    fs.writeFileSync(scriptFile, 'print("custom task")\nresult = {"done": True}\n');
    const { fake } = fakeGimp((script) => {
      expect(script).toContain('contextlib.redirect_stdout(script_output)');
      expect(script).toContain('exec(compile(');
      expect(script).toContain('"Gimp": Gimp');
      return { script: scriptFile, stdout: 'custom task\n', result: { done: true } };
    });

    const result = await runGimpCli(gimpHandlers(fake), ['script', 'run', scriptFile, '--json']);
    expect(result.code, result.err).toBe(0);
    expect(result.json()).toEqual({ script: scriptFile, stdout: 'custom task\n', result: { done: true } });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it('runs a custom Python script in GIMP and returns its output', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-script-live-'));
    const scriptFile = path.join(directory, 'task.py');
    fs.writeFileSync(scriptFile, 'print("script ran")\nresult = {"gimp_available": Gimp is not None}\n');
    try {
      const result = await runGimpCli(gimpHandlers(), ['script', 'run', scriptFile, '--json']);
      expect(result.code, result.err).toBe(0);
      expect(result.json()).toEqual({
        script: scriptFile,
        stdout: 'script ran\n',
        result: { gimp_available: true },
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
