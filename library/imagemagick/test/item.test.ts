import { describe, it, expect } from 'vitest';
import { imagemagick } from '../item.ts';

describe('ImageMagick library item', () => {
  it('includes its spec and handlers as library files', () => {
    expect(imagemagick.files).toEqual(['spec.ts', 'handlers.ts']);
    expect(imagemagick.binary).toBe(imagemagick.def.binary);
    expect(imagemagick.requires).toContainEqual(expect.objectContaining({ command: 'magick' }));
  });
});
