import { describe, it, expect } from 'vitest';
import { buildSpec, commands, lintSpec } from '../../../src/index.ts';
import { cli } from '../spec.ts';

describe('ImageMagick CLI schema', () => {
  it('builds a lint-clean command for every declared operation', () => {
    const spec = buildSpec(cli);
    expect(lintSpec(spec)).toEqual([]);
    expect(commands(spec).map((command) => command.op.operationId)).toEqual([
      'info',
      'resize',
      'crop',
      'trim',
      'pad',
      'convert',
      'overlay',
      'grid',
      'adjust',
      'effect',
      'transparent',
      'compare',
    ]);
  });
});
