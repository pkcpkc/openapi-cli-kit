import type { LibraryItem } from '../../src/library.ts';
import { cli } from './spec.ts';

export const gimp: LibraryItem = {
  name: 'gimp',
  binary: cli.binary,
  summary: 'Edit images, groups, layers and masks; run custom GIMP Python scripts and inspect focused PDB schemas',
  def: cli,
  files: [
    'spec.ts',
    'handlers.ts',
    'runtime.ts',
    'shared.ts',
    'python/helpers.py',
    'image-handlers.ts',
    'layer-handlers.ts',
    'bundle-handlers.ts',
    'pdb-handlers.ts',
    'script-handlers.ts',
  ],
  requires: [
    {
      command: 'gimp',
      macApp: 'GIMP.app',
      envVar: 'GIMP_BINARY',
      install: 'Install GIMP 3 from https://www.gimp.org/downloads/; macOS GIMP.app is auto-detected, otherwise put gimp on PATH or set GIMP_BINARY',
    },
  ],
};
