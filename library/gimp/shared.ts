import fs from 'node:fs';
import path from 'node:path';
import { CliError } from 'openapi-cli-kit';

export function requireFile(file: string): void {
  try {
    if (!fs.statSync(file).isFile()) throw new Error('not a file');
  } catch {
    throw new CliError(404, `Input file does not exist: ${file}`);
  }
}

export function prepareOutput(file: string, inputs: string[], xcf = false): void {
  const resolved = path.resolve(file);
  const sameAsInput = inputs.some((input) => {
    const source = path.resolve(input);
    return process.platform === 'darwin' || process.platform === 'win32' ? source.toLowerCase() === resolved.toLowerCase() : source === resolved;
  });
  if (sameAsInput) throw new CliError(400, 'Output must be a different path from every input file');
  if (xcf && path.extname(file).toLowerCase() !== '.xcf') throw new CliError(400, 'This operation preserves editable layers and requires an .xcf output path');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
}

export function parsePair(value: string, label: string): [number, number] {
  const values = value.split(',').map(Number);
  if (values.length !== 2 || values.some((number) => !Number.isInteger(number))) throw new CliError(400, `${label} must contain two integer values`);
  return [values[0], values[1]];
}

export function parseSize(value: string): [number, number] {
  const values = value.split('x').map(Number);
  if (values.length !== 2 || values.some((number) => !Number.isInteger(number) || number <= 0)) throw new CliError(400, '--size must be WIDTHxHEIGHT with positive dimensions');
  return [values[0], values[1]];
}

export function parseRect(value: string): [number, number, number, number] {
  const values = value.split(',').map(Number);
  if (values.length !== 4 || values.some((number) => !Number.isInteger(number)) || values[2] <= 0 || values[3] <= 0) {
    throw new CliError(400, '--rect must be x,y,width,height with positive dimensions');
  }
  return values as [number, number, number, number];
}
