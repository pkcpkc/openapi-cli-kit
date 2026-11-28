import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gimpHandlers } from '../handlers.ts';
import { fakeGimp, hasGimp, runGimpCli, solidPng } from './support.ts';

describe('GIMP image handlers', () => {
  it('assembles repeated input files as bottom-to-top layers and protects its inputs', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-assemble-'));
    const base = path.join(directory, 'base.png');
    const overlay = path.join(directory, 'overlay.png');
    const output = path.join(directory, 'project.xcf');
    fs.writeFileSync(base, 'fixture');
    fs.writeFileSync(overlay, 'fixture');
    const { fake, calls } = fakeGimp((script) => {
      expect(script).toContain(`files = ["${base}","${overlay}"]`);
      expect(script).toContain('Gimp.file_load_layer');
      expect(script).toContain('root = ensure_root(image)');
      expect(script).toContain('image.insert_layer(layer, root, 0)');
      return { file: output, width: 20, height: 10, format: 'XCF', layers: 2 };
    });

    const result = await runGimpCli(gimpHandlers(fake), ['image', 'assemble', '--layer', base, '--layer', overlay, '--out', output, '--json']);
    expect(result.code).toBe(0);
    expect(result.json()).toEqual({ file: output, width: 20, height: 10, format: 'XCF', layers: 2 });
    expect(calls).toHaveLength(1);

    const overwrite = await runGimpCli(gimpHandlers(fake), ['image', 'assemble', '--layer', base, '--out', base]);
    expect(overwrite.code).toBe(1);
    expect(overwrite.err).toMatch(/different path/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it('builds typed scripts for editable text, masks and non-destructive filters', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-image-'));
    const input = path.join(directory, 'source.xcf');
    fs.writeFileSync(input, 'fixture');
    const { fake } = fakeGimp((script) => {
      expect(script).toContain('Gimp.TextLayer.new');
      expect(script).toContain('layer.set_color(Gegl.Color.new("#ffffff"))');
      return { file: path.join(directory, 'result.xcf'), width: 20, height: 10, format: 'XCF', layers: 2 };
    });
    const text = await runGimpCli(gimpHandlers(fake), [
      'image', 'text', 'add', input, '--text', 'Sample', '--font', 'auto', '--size', '32', '--color', '#ffffff', '--at', '2,3',
      '--out', path.join(directory, 'result.xcf'), '--json',
    ]);
    expect(text.code).toBe(0);

    const maskFake = fakeGimp((script) => {
      expect(script).toContain('Gimp.AddMaskType.WHITE');
      expect(script).toContain('layer.add_mask(mask)');
      return { file: path.join(directory, 'masked.xcf'), width: 20, height: 10, format: 'XCF', layers: 1 };
    }).fake;
    const mask = await runGimpCli(gimpHandlers(maskFake), ['layers', 'mask-add', input, 'Background', '--type', 'white', '--out', path.join(directory, 'masked.xcf')]);
    expect(mask.code).toBe(0);

    const filterFake = fakeGimp((script) => {
      expect(script).toContain('"gegl:gaussian-blur"');
      expect(script).toContain('config.set_property("std-dev-x", 4)');
      expect(script).toContain('layer.append_filter(filter)');
      return { file: path.join(directory, 'blurred.xcf'), width: 20, height: 10, format: 'XCF', layers: 1 };
    }).fake;
    const filter = await runGimpCli(gimpHandlers(filterFake), [
      'image', 'effect', input, '--preset', 'blur', '--amount', '4', '--out', path.join(directory, 'blurred.xcf'),
    ]);
    expect(filter.code).toBe(0);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it('assembles, inspects, exports and adds a mask to a real multi-format project', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-live-'));
    const base = path.join(directory, 'base.png');
    const overlay = path.join(directory, 'overlay.png');
    const project = path.join(directory, 'project.xcf');
    const output = path.join(directory, 'export.webp');
    const masked = path.join(directory, 'masked.xcf');
    fs.writeFileSync(base, solidPng(32, 24, [220, 30, 30, 255]));
    fs.writeFileSync(overlay, solidPng(12, 10, [20, 40, 220, 180]));

    try {
      const assembled = await runGimpCli(gimpHandlers(), ['image', 'assemble', '--layer', base, '--layer', overlay, '--out', project, '--json']);
      expect(assembled.code, assembled.err).toBe(0);
      expect(assembled.json()).toMatchObject({ width: 32, height: 24, format: 'XCF', layers: 3 });

      const listed = await runGimpCli(gimpHandlers(), ['layers', 'list', project, '--json']);
      expect(listed.code, listed.err).toBe(0);
      expect(listed.json().layers).toHaveLength(1);
      expect(listed.json().layers[0]).toMatchObject({ name: 'Root', path: 'Root', group: true });
      expect(listed.json().layers[0].children).toHaveLength(2);
      expect(listed.json().layers[0].children[0].name).toContain('overlay');
      expect(listed.json().layers[0].children[1].name).toContain('base');
      const topLayer = listed.json().layers[0].children[0].path as string;

      const exported = await runGimpCli(gimpHandlers(), ['image', 'export', project, '--out', output, '--json']);
      expect(exported.code, exported.err).toBe(0);
      expect(fs.statSync(output).size).toBeGreaterThan(0);
      expect(exported.json()).toMatchObject({ width: 32, height: 24, format: 'WEBP' });

      const withMask = await runGimpCli(gimpHandlers(), ['layers', 'mask-add', project, 'Root', '--type', 'white', '--out', masked, '--json']);
      expect(withMask.code, withMask.err).toBe(0);
      expect(fs.statSync(masked).size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
  it('runs real GIMP text, effect, transform, crop, watermark, layer and path workflows', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-workflows-'));
    const base = path.join(directory, 'base.png');
    const logo = path.join(directory, 'logo.png');
    const project = path.join(directory, 'project.xcf');
    fs.writeFileSync(base, solidPng(32, 24, [220, 30, 30, 255]));
    fs.writeFileSync(logo, solidPng(8, 8, [20, 40, 220, 180]));

    const command = async (argv: string[]) => {
      const result = await runGimpCli(gimpHandlers(), [...argv, '--json']);
      expect(result.code, result.err).toBe(0);
      return result.json();
    };

    try {
      await command(['image', 'import', base, '--out', project]);
      const text = await command([
        'image', 'text', 'add', project, '--text', 'GIMP', '--font', 'auto', '--size', '12', '--color', '#ffffff', '--at', '1,1',
        '--out', path.join(directory, 'text.xcf'),
      ]);
      expect(text).toMatchObject({ width: 32, height: 24, layers: 3 });

      const effect = await command(['image', 'effect', project, '--preset', 'blur', '--amount', '2', '--out', path.join(directory, 'effect.xcf')]);
      expect(effect).toMatchObject({ width: 32, height: 24, layers: 2 });

      const resized = await command(['image', 'resize', project, '--size', '16x12', '--out', path.join(directory, 'resized.xcf')]);
      expect(resized).toMatchObject({ width: 16, height: 12 });

      const cropped = await command(['image', 'crop', project, '--rect', '2,3,20,15', '--out', path.join(directory, 'cropped.xcf')]);
      expect(cropped).toMatchObject({ width: 20, height: 15 });

      const transformed = await command(['image', 'transform', project, '--rotate', '90', '--flip', 'horizontal', '--out', path.join(directory, 'transformed.xcf')]);
      expect(transformed).toMatchObject({ width: 24, height: 32 });

      const watermarked = await command([
        'image', 'watermark', project, '--logo', logo, '--at', '4,5', '--opacity', '40', '--out', path.join(directory, 'watermarked.xcf'),
      ]);
      expect(watermarked).toMatchObject({ width: 32, height: 24, layers: 3 });

      const flattened = await command(['image', 'flatten', project, '--out', path.join(directory, 'flat.png')]);
      expect(flattened).toMatchObject({ width: 32, height: 24, layers: 1 });

      const listing = await command(['layers', 'list', project]);
      const layerPath = (listing.layers as Array<{ children: Array<{ path: string }> }>)[0].children[0].path;
      const bundleDirectory = path.join(directory, 'layers');
      const layers = await command(['layers', 'export', project, layerPath, '--dir', bundleDirectory]);
      expect(fs.statSync(path.join(directory, 'layers', 'layer.png')).size).toBeGreaterThan(0);
      expect(fs.statSync(path.join(directory, 'layers', 'layer.xcf')).size).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(directory, 'layers', 'manifest.json'))).toBe(true);
      expect(layers.directory).toBe(path.join(directory, 'layers'));

      const imported = await command(['layers', 'import', project, '--bundle', bundleDirectory, '--group', 'Root', '--out', path.join(directory, 'reimported.xcf')]);
      expect(imported).toMatchObject({ width: 32, height: 24 });

      const paths = await command(['paths', 'export', project, '--dir', path.join(directory, 'paths')]);
      expect(paths).toMatchObject({ directory: path.join(directory, 'paths'), files: [] });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
