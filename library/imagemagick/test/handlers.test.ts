import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { magickHandlers, magickRunner } from '../handlers.ts';
import { cli } from '../spec.ts';
import { CliError } from '../../../src/index.ts';
import { alphaAt, channelAt, fakeMagick, hasMagick, outputInfo, picture, run, solidImage, tempDir, withImage } from './support.ts';

describe('magick-cli (the magick calls)', () => {
  it('composes exactly one handler per CLI operation', () => {
    const handlers = magickHandlers(async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(new Set(Object.keys(handlers))).toEqual(new Set(cli.ops.map((op) => op.id)));
  });

  it('reads an image: size, format, alpha and frames', async () => {
    const { file } = await withImage();
    const { magick } = fakeMagick();
    const { code, json } = await run(magickHandlers(magick), ['info', file, '--json']);
    expect(code).toBe(0);
    expect(json()).toEqual({ file, width: 40, height: 30, format: 'PNG', colorspace: 'sRGB', alpha: true, depth: 8, frames: 1 });
  });

  it('resizes to fit, to cover or by percent, and wants one of --size and --scale', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick();
    const out = path.join(dir, 'nested', 'out.png');
    const { json } = await run(magickHandlers(magick), ['resize', file, '--size', '20x20', '--fit', 'cover', '-o', out, '--json']);
    expect(json()).toEqual({ file: out, width: 40, height: 30, format: 'PNG' });
    expect(fs.existsSync(path.dirname(out))).toBe(true);
    await run(magickHandlers(magick), ['resize', file, '--scale', '50', '-o', out]);
    expect(written()).toEqual([
      [`${file}[0]`, '-resize', '20x20^', '-gravity', 'center', '-extent', '20x20', out],
      [`${file}[0]`, '-resize', '50%', out],
    ]);
    expect((await run(magickHandlers(magick), ['resize', file, '-o', out])).code).toBe(1);
    expect((await run(magickHandlers(magick), ['resize', file, '--size', '2x2', '--scale', '5', '-o', out])).code).toBe(1);
  });

  it('crops a rectangle inside the image, and refuses one outside it', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick();
    await run(magickHandlers(magick), ['crop', file, '--rect', '10,5,11,11', '-o', path.join(dir, 'c.png')]);
    expect(written()[0]).toEqual([`${file}[0]`, '-crop', '11x11+10+5', '+repage', path.join(dir, 'c.png')]);
    const { code, err } = await run(magickHandlers(magick), ['crop', file, '--rect', '50,5,2,2', '-o', path.join(dir, 'c.png')]);
    expect([code, err]).toEqual([1, expect.stringMatching(/outside the 40x30 image/)]);
  });

  it('trims to the box ImageMagick finds and reports it', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick((args) => (args.includes('info:') ? { stdout: '11x12+10+5' } : {}));
    const { json } = await run(magickHandlers(magick), ['trim', file, '--fuzz', '5', '-o', path.join(dir, 't.png'), '--json']);
    expect(json().box).toEqual({ x: 10, y: 5, width: 11, height: 12 });
    expect(written()[0]).toEqual([`${file}[0]`, '-fuzz', '5%', '-format', '%@', 'info:']);
    expect(written()[1]).toEqual([`${file}[0]`, '-crop', '11x12+10+5', '+repage', path.join(dir, 't.png')]);
  });

  it('pads by a margin or to a size no smaller than the image', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick();
    const out = path.join(dir, 'p.png');
    await run(magickHandlers(magick), ['pad', file, '--margin', '4', '--background', 'black', '-o', out]);
    await run(magickHandlers(magick), ['pad', file, '--size', '60x60', '-g', 'north', '-o', out]);
    expect(written()).toEqual([
      [`${file}[0]`, '-bordercolor', 'black', '-compose', 'Copy', '-border', '4', out],
      [`${file}[0]`, '-background', 'none', '-gravity', 'north', '-extent', '60x60', out],
    ]);
    expect((await run(magickHandlers(magick), ['pad', file, '--size', '20x20', '-o', out])).err).toMatch(/smaller than the 40x30 image/);
  });

  it('flattens onto white for a JPEG, and takes quality and strip', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick();
    await run(magickHandlers(magick), ['convert', file, '-q', '80', '--strip', '-o', path.join(dir, 'x.jpg')]);
    await run(magickHandlers(magick), ['convert', file, '-o', path.join(dir, 'x.webp')]);
    expect(written()).toEqual([
      [`${file}[0]`, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-quality', '80', '-strip', path.join(dir, 'x.jpg')],
      [`${file}[0]`, path.join(dir, 'x.webp')],
    ]);
    expect((await run(magickHandlers(magick), ['convert', file, '-o', path.join(dir, 'x.txt')])).code).toBe(1);
  });

  it('overlays at an offset, with opacity and a blend', async () => {
    const { dir, file } = await withImage();
    fs.writeFileSync(path.join(dir, 'top.png'), 'png');
    const { magick, written } = fakeMagick();
    await run(magickHandlers(magick), ['overlay', file, path.join(dir, 'top.png'), '--at', '-5,3', '--opacity', '50', '-b', 'multiply', '-o', path.join(dir, 'o.png')]);
    expect(written()[0]).toEqual([
      `${file}[0]`,
      '(', `${path.join(dir, 'top.png')}[0]`, '-alpha', 'set', '-channel', 'A', '-evaluate', 'multiply', '0.5', '+channel', ')',
      '-gravity', 'northwest', '-geometry', '-5+3', '-compose', 'multiply', '-composite', path.join(dir, 'o.png'),
    ]);
  });

  it('lays out a grid: square-ish by default, the gap between cells and around them', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick();
    const out = path.join(dir, 'g.png');
    const { json } = await run(magickHandlers(magick), ['grid', '-i', file, '-i', file, '-i', file, '--gap', '6', '-o', out, '--json']);
    expect(json()).toMatchObject({ columns: 2, rows: 2 });
    expect(written()).toEqual([
      ['montage', `${file}[0]`, `${file}[0]`, `${file}[0]`, '-tile', '2x', '-geometry', '+3+3', '-background', 'none', out],
      [out, '-bordercolor', 'none', '-compose', 'Copy', '-border', '3', out],
    ]);
    expect((await run(magickHandlers(magick), ['grid', '-i', path.join(dir, 'missing.png'), '-o', out])).code).toBe(2);
  });

  it('adjusts colours and applies effects, and wants at least one of them', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick();
    const out = path.join(dir, 'a.png');
    await run(magickHandlers(magick), ['adjust', file, '--hue', '90', '--saturation', '120', '--contrast', '20', '--grayscale', '-o', out]);
    await run(magickHandlers(magick), ['effect', file, '--blur', '2', '--posterize', '4', '--halftone', '6', '-o', out]);
    expect(written()).toEqual([
      [`${file}[0]`, '-modulate', '100,120,150', '-brightness-contrast', '0x20', '-colorspace', 'Gray', out],
      [`${file}[0]`, '-blur', '0x2', '-posterize', '4', '-ordered-dither', 'h6x6a', out],
    ]);
    expect((await run(magickHandlers(magick), ['adjust', file, '-o', out])).code).toBe(1);
    expect((await run(magickHandlers(magick), ['effect', file, '--halftone', '5', '-o', out])).code).toBe(1);
  });

  it('clears a colour everywhere, or only the areas connected to --at points', async () => {
    const { dir, file } = await withImage();
    const { magick, written } = fakeMagick();
    const out = path.join(dir, 't.png');
    await run(magickHandlers(magick), ['transparent', file, '-o', out]);
    await run(magickHandlers(magick), ['transparent', file, '--at', '0,0', '--at', '39,29', '--fuzz', '5', '-o', out]);
    expect(written()).toEqual([
      [`${file}[0]`, '-alpha', 'set', '-fuzz', '10%', '-transparent', 'white', out],
      [`${file}[0]`, '-alpha', 'set', '-fuzz', '5%', '-fill', 'none', '-draw', 'color 0,0 floodfill', '-draw', 'color 39,29 floodfill', out],
    ]);
    expect((await run(magickHandlers(magick), ['transparent', file, '--at', '40,0', '-o', out])).code).toBe(1);
  });

  it('compares two images of the same size (compare exits 1 when they differ)', async () => {
    const { dir, file } = await withImage();
    fs.writeFileSync(path.join(dir, 'b.png'), 'png');
    const { magick } = fakeMagick(() => ({ code: 1, stderr: '13421.8 (0.204812)' }));
    const { code, json } = await run(magickHandlers(magick), ['compare', file, path.join(dir, 'b.png'), '--json']);
    expect(code).toBe(0);
    expect(json()).toMatchObject({ rmse: 0.204812, same: false });
  });

  it('maps failures to exit codes: a missing file, bad input, a crash, no ImageMagick', async () => {
    const { dir, file } = await withImage();
    const out = path.join(dir, 'o.png');
    expect((await run(magickHandlers(fakeMagick().magick), ['info', path.join(dir, 'nope.png')])).code).toBe(2);
    const badColour = fakeMagick(() => ({ stderr: "magick: unrecognized color `blu' @ warning/color.c/GetColorCompliance/1066." }));
    expect(await run(magickHandlers(badColour.magick), ['pad', file, '--margin', '2', '--background', 'blu', '-o', out])).toMatchObject({ code: 1, err: expect.stringMatching(/Unrecognized color "blu"/) });
    const badImage = fakeMagick(() => ({ code: 1, stderr: 'magick: improper image header `in.png\' @ error/png.c/ReadPNGImage/4092.' }));
    expect((await run(magickHandlers(badImage.magick), ['resize', file, '--scale', '50', '-o', out])).code).toBe(1);
    const crash = fakeMagick(() => ({ code: 1, stderr: 'magick: cache resources exhausted' }));
    expect((await run(magickHandlers(crash.magick), ['resize', file, '--scale', '50', '-o', out])).code).toBe(5);
    const { code, err } = await run(magickHandlers(magickRunner({ MAGICK_BINARY: path.join(dir, 'no-magick') })), ['info', file, '--json']);
    expect(code).toBe(4);
    expect(JSON.parse(err)).toMatchObject({ status: 503, hint: expect.stringMatching(/brew install imagemagick/) });
    await expect(magickRunner({ MAGICK_BINARY: path.join(dir, 'no-magick') })(['-version'])).rejects.toBeInstanceOf(CliError);
  });
});

describe.skipIf(!hasMagick)('magick-cli (with ImageMagick)', () => {
  it('reads image info', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    picture(file);
    const handlers = magickHandlers();
    expect(await outputInfo(handlers, file)).toMatchObject({ width: 8, height: 6, format: 'PNG', alpha: false });
  });

  it('resizes to the requested dimensions', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'resized.png');
    picture(file);
    const handlers = magickHandlers();
    expect((await run(handlers, ['resize', file, '--size', '4x4', '--fit', 'stretch', '-o', out])).code).toBe(0);
    expect(await outputInfo(handlers, out)).toMatchObject({ width: 4, height: 4 });
  });

  it('crops the requested pixels', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'crop.png');
    picture(file);
    const handlers = magickHandlers();
    expect((await run(handlers, ['crop', file, '--rect', '3,2,2,2', '-o', out])).code).toBe(0);
    expect(await outputInfo(handlers, out)).toMatchObject({ width: 2, height: 2 });
    expect(channelAt(out, 0, 0, 'r')).toBe(1);
    expect(channelAt(out, 0, 0, 'g')).toBe(0);
  });

  it('trims to the red square and reports its source box', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'trimmed.png');
    picture(file);
    const result = await run(magickHandlers(), ['trim', file, '-o', out, '--json']);
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({ width: 2, height: 2, box: { x: 3, y: 2, width: 2, height: 2 } });
  });

  it('pads the image with the requested border', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'padded.png');
    picture(file);
    const handlers = magickHandlers();
    expect((await run(handlers, ['pad', file, '--margin', '1', '--background', 'black', '-o', out])).code).toBe(0);
    expect(await outputInfo(handlers, out)).toMatchObject({ width: 10, height: 8 });
    expect(channelAt(out, 0, 0, 'r')).toBe(0);
  });

  it('converts to the format named by the output extension', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'converted.jpg');
    picture(file);
    const handlers = magickHandlers();
    expect((await run(handlers, ['convert', file, '-o', out])).code).toBe(0);
    expect(await outputInfo(handlers, out)).toMatchObject({ width: 8, height: 6, format: 'JPEG' });
  });

  it('composites an overlay at the requested offset', async () => {
    const dir = await tempDir();
    const base = path.join(dir, 'base.png');
    const overlay = path.join(dir, 'overlay.png');
    const out = path.join(dir, 'composed.png');
    picture(base);
    solidImage(overlay, 'blue', '2x2');
    const handlers = magickHandlers();
    expect((await run(handlers, ['overlay', base, overlay, '--at', '1,1', '-o', out])).code).toBe(0);
    expect(channelAt(out, 1, 1, 'b')).toBe(1);
    expect(channelAt(out, 0, 0, 'r')).toBe(1);
  });

  it('lays images out in the requested grid', async () => {
    const dir = await tempDir();
    const red = path.join(dir, 'red.png');
    const blue = path.join(dir, 'blue.png');
    const out = path.join(dir, 'grid.png');
    solidImage(red, 'red', '8x6');
    solidImage(blue, 'blue', '8x6');
    const result = await run(magickHandlers(), ['grid', '-i', red, '-i', blue, '--columns', '2', '-o', out, '--json']);
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({ columns: 2, rows: 1 });
    expect(channelAt(out, 0, 0, 'r')).toBe(1);
    expect(channelAt(out, 8, 0, 'b')).toBe(1);
  });

  it('adjusts an image to grayscale', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'gray.png');
    picture(file);
    const handlers = magickHandlers();
    expect((await run(handlers, ['adjust', file, '--grayscale', '-o', out])).code).toBe(0);
    expect(await outputInfo(handlers, out)).toMatchObject({ colorspace: 'Gray' });
  });

  it('applies an effect to the image pixels', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'blurred.png');
    picture(file);
    const handlers = magickHandlers();
    expect((await run(handlers, ['effect', file, '--blur', '1', '-o', out])).code).toBe(0);
    expect(channelAt(out, 2, 2, 'g')).toBeLessThan(1);
  });

  it('clears only the background connected to the selected point', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    const out = path.join(dir, 'clear.png');
    picture(file);
    const handlers = magickHandlers();
    expect((await run(handlers, ['transparent', file, '--at', '0,0', '-o', out])).code).toBe(0);
    expect([alphaAt(out, 0, 0), alphaAt(out, 3, 2)]).toEqual([0, 1]);
  });

  it('compares identical images', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    picture(file);
    const result = await run(magickHandlers(), ['compare', file, file, '--json']);
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({ rmse: 0, same: true });
  });
});
