import { runCli, type Handlers, type Io } from './runner/run.ts';
import { loadSpec, type CliSpec } from './runner/spec.ts';

/** How long an optional stdin may stay silent before it counts as none (an agent's shell may leave it open). */
const STDIN_GRACE_MS = 250;

/** Stdin's text: all of it when required, else only what arrives right away; null from a terminal. */
export function readStdin(required: boolean): Promise<string | null> {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const timer = required ? null : setTimeout(() => finish(true), STDIN_GRACE_MS);
    const finish = (silent = false) => {
      if (timer) clearTimeout(timer);
      process.stdin.removeAllListeners('data').removeAllListeners('end');
      process.stdin.pause();
      resolve(silent && !chunks.length ? null : Buffer.concat(chunks).toString('utf8'));
    };
    process.stdin.on('data', (chunk: Buffer) => {
      if (timer) clearTimeout(timer);
      chunks.push(chunk);
    });
    process.stdin.on('end', () => finish());
    process.stdin.on('error', () => finish(true));
  });
}

/** The process's own terminal: stdout, stderr, stdin, working folder and environment. */
export const processIo = (): Io => ({
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  readStdin,
  cwd: process.cwd(),
  env: process.env,
});

/**
 * Runs a CLI as the process: its spec (the `<binary>.openapi.json` file, or the document) on `process.argv`, its
 * handlers behind it. Sets `process.exitCode` by the outcome. A launcher (`bin/<binary>.mjs`) is one call to this.
 */
export async function runProcess(spec: string | URL | CliSpec, handlers: Handlers, argv = process.argv.slice(2)): Promise<number> {
  const doc = typeof spec === 'string' || spec instanceof URL ? loadSpec(spec) : spec;
  const code = await runCli(doc, handlers, argv, processIo());
  process.exitCode = code;
  return code;
}
