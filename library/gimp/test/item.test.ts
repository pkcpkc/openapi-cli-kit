import { describe, it, expect } from 'vitest';
import { gimp } from '../item.ts';

describe('GIMP library item', () => {
  it('includes every runtime module and the standalone Python helper', () => {
    expect(gimp.files).toContain('python/helpers.py');
    expect(gimp.files).toContain('bundle-handlers.ts');
    expect(gimp.files).toContain('runtime.ts');
    expect(gimp.requires).toContainEqual(expect.objectContaining({ command: 'gimp', macApp: 'GIMP.app' }));
  });
});
