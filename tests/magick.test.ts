import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { magickHandlers, magickRunner, type MagickRun } from '../library/magick/handlers.ts';
import { cli } from '../library/magick/spec.ts';
import { CliError, buildSpec, runCli, type Handlers, type Io } from '../src/index.ts';

const spec = buildSpec(cli);
const tempDir = async () => fs.mkdtempSync(path.join(os.tmpdir(), 'magick-cli-'));

async function run(handlers: Handlers, argv: string[]) {
  const sink = { out: '', err: '' };
  const io: Io = { stdout: (t) => void (sink.out += t), stderr: (t) => void (sink.err += t), readStdin: async () => null, cwd: process.cwd(), env: {} };
  const code = await runCli(spec, handlers, argv, io);
  return { code, ...sink, json: () => JSON.parse(sink.out) };
}

/** A fake ImageMagick: records each call, answers identify with a 40x30 PNG, and anything else from `answer`. */
function fakeMagick(answer: (args: string[]) => { code?: number; stdout?: string; stderr?: string } = () => ({})) {
  const calls: string[][] = [];
  const magick: MagickRun = async (args) => {
    calls.push(args);
    if (args[0] === 'identify') return { code: 0, stdout: '40|30|PNG|sRGB|srgba 5.0|8\n', stderr: '' };
    const result = { code: 0, stdout: '', stderr: '', ...answer(args) };
    // Like ImageMagick, it writes the file named last
    if (!result.code && !args.includes('info:') && args[0] !== 'compare') fs.writeFileSync(args[args.length - 1], 'png');
    return result;
  };
  return { magick, calls, written: () => calls.filter((c) => c[0] !== 'identify') };
}

/** A temp folder with a (placeholder) image in it. */
async function withImage(name = 'in.png') {
  const dir = await tempDir();
  fs.writeFileSync(path.join(dir, name), 'png');
  return { dir, file: path.join(dir, name) };
}

describe('magick-cli (the magick calls)', () => {
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

/** Whether ImageMagick 7 runs here (the real-pixel checks are skipped without it). */
const hasMagick = (() => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasMagick)('magick-cli (with ImageMagick)', () => {
  /** Writes a white 8x6 PNG with a red 2x2 square at 3,2. */
  const picture = (file: string) => execFileSync('magick', ['-size', '8x6', 'xc:white', '-fill', 'red', '-draw', 'rectangle 3,2 4,3', file]);
  /** The alpha (0-1) of a pixel. */
  const alphaAt = (file: string, x: number, y: number) => Number(execFileSync('magick', [file, '-format', `%[fx:p{${x},${y}}.a]`, 'info:']).toString());

  it('trims to the red square, clears the white background, and compares', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'in.png');
    picture(file);
    const handlers = magickHandlers();
    const trimmed = await run(handlers, ['trim', file, '-o', path.join(dir, 't.png'), '--json']);
    expect(trimmed.json()).toMatchObject({ width: 2, height: 2, box: { x: 3, y: 2, width: 2, height: 2 } });

    await run(handlers, ['transparent', file, '--at', '0,0', '-o', path.join(dir, 'clear.png')]);
    expect([alphaAt(path.join(dir, 'clear.png'), 0, 0), alphaAt(path.join(dir, 'clear.png'), 3, 2)]).toEqual([0, 1]);

    expect((await run(handlers, ['compare', file, file, '--json'])).json()).toMatchObject({ rmse: 0, same: true });
    expect((await run(handlers, ['compare', file, path.join(dir, 't.png')])).code).toBe(1);
  });
});
