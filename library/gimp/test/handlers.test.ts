import { describe, it, expect } from 'vitest';
import { gimpHandlers } from '../handlers.ts';
import { cli } from '../spec.ts';

describe('GIMP handler composition', () => {
  it('provides exactly one composed handler per CLI operation', () => {
    const handlers = gimpHandlers(async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(new Set(Object.keys(handlers))).toEqual(new Set(cli.ops.map((operation) => operation.id)));
  });
});
