import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { gimpHandlers, resolveGimpBinary, type GimpRun } from '../handlers.ts';
import { cli } from '../spec.ts';
import { buildSpec, runCli, type Io, type Handlers } from '../../../src/index.ts';

const spec = buildSpec(cli);

export async function runGimpCli(handlers: Handlers, argv: string[]) {
  const sink = { out: '', err: '' };
  const io: Io = { stdout: (text) => void (sink.out += text), stderr: (text) => void (sink.err += text), readStdin: async () => null, cwd: process.cwd(), env: {} };
  const code = await runCli(spec, handlers, argv, io);
  return { code, ...sink, json: () => JSON.parse(sink.out) };
}

export function fakeGimp(answer: (script: string) => Record<string, unknown> = () => ({})) {
  const calls: string[][] = [];
  const fake: GimpRun = async (args) => {
    calls.push(args);
    const expression = args[args.indexOf('-b') + 1];
    const match = /^exec\(open\(("(?:[^"\\]|\\.)*"), encoding="utf-8"\)\.read\(\)\)$/.exec(expression);
    if (!match) throw new Error(`Unexpected batch expression: ${expression}`);
    const script = fs.readFileSync(JSON.parse(match[1]) as string, 'utf8');
    const output = /^OUTPUT = (.+)$/m.exec(script);
    if (!output) throw new Error('Batch script has no response path');
    if (!script.includes('with open(HELPERS')) throw new Error('Batch script does not load the Python helper module');
    fs.writeFileSync(JSON.parse(output[1]) as string, JSON.stringify(answer(script)));
    const dump = /dump_to_file\(file\)/.test(script) && /file = Gio\.File\.new_for_path\(("(?:[^"\\]|\\.)*")\)/.exec(script);
    if (dump) fs.writeFileSync(JSON.parse(dump[1]) as string, 'local PDB dump');
    return { code: 0, stdout: '', stderr: '' };
  };
  return { fake, calls };
}

export const hasGimp = (() => {
  try {
    execFileSync(resolveGimpBinary(), ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

export function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const name = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.from([0, ...Array.from({ length: width }, () => rgba).flat()]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
