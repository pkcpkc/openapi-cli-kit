import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli, type CliSpec, type Handlers, type Io } from '../src/index.ts';

export const tempDir = (prefix = 'openapi-cli-'): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Runs a CLI without a terminal: what it printed, its exit code, and stdout as JSON. */
export async function run(spec: CliSpec, handlers: Handlers, argv: string[], cwd = process.cwd()) {
  const sink = { out: '', err: '' };
  const io: Io = { stdout: (t) => void (sink.out += t), stderr: (t) => void (sink.err += t), readStdin: async () => null, cwd, env: {} };
  const code = await runCli(spec, handlers, argv, io);
  return { code, ...sink, json: () => JSON.parse(sink.out) };
}
