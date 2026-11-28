import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { magickHandlers, type MagickRun } from '../handlers.ts';
import { cli } from '../spec.ts';
import { buildSpec, runCli, type Handlers, type Io } from '../../../src/index.ts';

const spec = buildSpec(cli);

export async function run(handlers: Handlers, argv: string[]) {
  const sink = { out: '', err: '' };
  const io: Io = { stdout: (text) => void (sink.out += text), stderr: (text) => void (sink.err += text), readStdin: async () => null, cwd: process.cwd(), env: {} };
  const code = await runCli(spec, handlers, argv, io);
  return { code, ...sink, json: () => JSON.parse(sink.out) };
}

export function fakeMagick(answer: (args: string[]) => { code?: number; stdout?: string; stderr?: string } = () => ({})) {
  const calls: string[][] = [];
  const magick: MagickRun = async (args) => {
    calls.push(args);
    if (args[0] === 'identify') return { code: 0, stdout: '40|30|PNG|sRGB|srgba 5.0|8\n', stderr: '' };
    const result = { code: 0, stdout: '', stderr: '', ...answer(args) };
    if (!result.code && !args.includes('info:') && args[0] !== 'compare') fs.writeFileSync(args[args.length - 1], 'png');
    return result;
  };
  return { magick, calls, written: () => calls.filter((call) => call[0] !== 'identify') };
}

export async function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'magick-cli-'));
}

export async function withImage(name = 'in.png') {
  const dir = await tempDir();
  fs.writeFileSync(path.join(dir, name), 'png');
  return { dir, file: path.join(dir, name) };
}

export const hasMagick = (() => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

export function picture(file: string) {
  execFileSync('magick', ['-size', '8x6', 'xc:white', '-fill', 'red', '-draw', 'rectangle 3,2 4,3', file]);
}

export function solidImage(file: string, color: string, size: string) {
  execFileSync('magick', ['-size', size, `xc:${color}`, file]);
}

export function alphaAt(file: string, x: number, y: number) {
  return Number(execFileSync('magick', [file, '-format', `%[fx:p{${x},${y}}.a]`, 'info:']).toString());
}

export function channelAt(file: string, x: number, y: number, channel: 'r' | 'g' | 'b') {
  return Number(execFileSync('magick', [file, '-format', `%[fx:p{${x},${y}}.${channel}]`, 'info:']).toString());
}

export async function outputInfo(handlers: Handlers, file: string) {
  const result = await run(handlers, ['info', file, '--json']);
  if (result.code !== 0) throw new Error(`Image info failed: ${result.err}`);
  return result.json();
}

export { magickHandlers };
