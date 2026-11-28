import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../../src/index.ts';
import { parsePair, parseRect, parseSize, prepareOutput, requireFile } from '../shared.ts';

describe('GIMP shared helpers', () => {
  it('parses pixel coordinates, sizes and rectangles, rejecting invalid dimensions', () => {
    expect(parsePair('-2,8', '--at')).toEqual([-2, 8]);
    expect(parseSize('320x240')).toEqual([320, 240]);
    expect(parseRect('1,2,30,40')).toEqual([1, 2, 30, 40]);
    expect(() => parsePair('1,2,3', '--at')).toThrow(CliError);
    expect(() => parseSize('0x20')).toThrow(CliError);
    expect(() => parseRect('1,2,0,4')).toThrow(CliError);
  });

  it('protects input files and requires XCF outputs for editable operations', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-shared-'));
    const input = path.join(directory, 'source.png');
    fs.writeFileSync(input, 'fixture');
    try {
      expect(() => requireFile(path.join(directory, 'missing.png'))).toThrow(CliError);
      expect(() => prepareOutput(input, [input])).toThrow(/different path/);
      expect(() => prepareOutput(path.join(directory, 'result.png'), [input], true)).toThrow(/requires an \.xcf/);
      const output = path.join(directory, 'nested', 'result.xcf');
      prepareOutput(output, [input], true);
      expect(fs.existsSync(path.dirname(output))).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
