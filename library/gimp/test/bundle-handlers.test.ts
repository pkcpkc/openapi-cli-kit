import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleHandlers } from '../bundle-handlers.ts';
import { fakeGimp, runGimpCli } from './support.ts';

describe('GIMP layer bundle handlers', () => {
  it('exports a selected layer/group as an editable bundle with a manifest and masks', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-bundle-export-'));
    const input = path.join(directory, 'project.xcf');
    const bundle = path.join(directory, 'bundle');
    fs.writeFileSync(input, 'fixture');
    const { fake } = fakeGimp((script) => {
      expect(script).toContain('editable = image.duplicate()');
      expect(script).toContain('"formatVersion": 1');
      expect(script).toContain('export_masks(item');
      return {
        directory: bundle,
        image: path.join(bundle, 'layer.png'),
        xcf: path.join(bundle, 'layer.xcf'),
        manifest: path.join(bundle, 'manifest.json'),
        masks: [],
      };
    });

    try {
      const result = await runGimpCli(bundleHandlers(fake), ['layers', 'export', input, 'Root/Group', '--dir', bundle, '--json']);
      expect(result.code, result.err).toBe(0);
      expect(result.json()).toMatchObject({ directory: bundle, masks: [] });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('imports the bundle PNG and restores mask pixels/settings through GIMP', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-bundle-import-'));
    const input = path.join(directory, 'project.xcf');
    const bundle = path.join(directory, 'bundle');
    fs.mkdirSync(bundle);
    fs.writeFileSync(input, 'fixture');
    fs.writeFileSync(path.join(bundle, 'layer.png'), 'fixture');
    fs.writeFileSync(path.join(bundle, 'layer.xcf'), 'fixture');
    fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify({
      formatVersion: 1,
      sourcePath: 'Root/Layer',
      item: { name: 'Layer', opacity: 85, visible: true, x: 2, y: 3 },
    }));
    const { fake } = fakeGimp((script) => {
      expect(script).toContain('Gegl.AbyssPolicy.NONE');
      expect(script).toContain('target_buffer.flush()');
      expect(script).toContain('layer.set_name("Layer")');
      return { file: path.join(directory, 'restored.xcf'), width: 20, height: 10, format: 'XCF', layers: 2 };
    });

    try {
      const output = path.join(directory, 'restored.xcf');
      const result = await runGimpCli(bundleHandlers(fake), [
        'layers', 'import', input, '--bundle', bundle, '--group', 'Root', '--out', output, '--json',
      ]);
      expect(result.code, result.err).toBe(0);
      expect(result.json()).toMatchObject({ file: output, format: 'XCF' });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
