import type { LibraryItem } from '../../src/library.ts';
import { cli } from './spec.ts';

export const imagemagick: LibraryItem = {
  name: 'imagemagick',
  binary: cli.binary,
  summary: 'ImageMagick 7 as typed commands: info, resize, crop, trim, pad, convert, overlay, grid, adjust, effect, transparent, compare',
  def: cli,
  files: ['spec.ts', 'handlers.ts'],
  requires: [{ command: 'magick', install: 'install ImageMagick 7 (macOS: brew install imagemagick; others: https://imagemagick.org/script/download.php)' }],
};
