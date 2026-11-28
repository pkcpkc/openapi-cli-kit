import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError, type Handlers } from 'openapi-cli-kit';

/** One `magick` call: its exit code and output (a failure to start, e.g. no ImageMagick, rejects). */
export type MagickRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Runs ImageMagick 7: `MAGICK_BINARY`, else `magick` on the PATH. Arguments go to it as they are: no shell. */
export function magickRunner(env: Record<string, string | undefined> = process.env): MagickRun {
  const bin = env.MAGICK_BINARY || 'magick';
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : err ? -1 : 0;
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new CliError(503, `ImageMagick is not installed (no ${bin} to run)`, 'Install ImageMagick 7 (brew install imagemagick), or set MAGICK_BINARY to the magick binary'));
        } else resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      });
    });
}

/** Messages of ImageMagick that mean the input was wrong, not that it broke. */
const USAGE_ERROR = /unrecognized|invalid argument|no decode delegate|improper image header|unable to open image|not a .* image|negative or zero image size/i;

const OUTPUT_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp']);

/** An input file, as ImageMagick reads it: its first frame only. A missing one is a 404. */
function input(file: string, allFrames = false): string {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new CliError(404, `No such file: ${file}`);
  return allFrames ? file : `${file}[0]`;
}

/** The --out file, its folder made; its extension must name an image format. */
function output(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!OUTPUT_FORMATS.has(ext)) throw new CliError(400, `--out ${file}: give an image file name (${[...OUTPUT_FORMATS].join(', ')})`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

const pair = (text: string): [number, number] => text.split(',').map(Number) as [number, number];
const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);
const sizeOf = (text: string): [number, number] => {
  const [w, h] = text.split('x').map(Number);
  if (!w || !h) throw new CliError(400, `--size ${text}: width and height must be at least 1`);
  return [w, h];
};

export interface ImageInfo {
  file: string;
  width: number;
  height: number;
  format: string;
  colorspace: string;
  alpha: boolean;
  depth: number;
  frames: number;
}

/** The handlers of `magick-cli` (`spec.ts`): ImageMagick on files. */
export function magickHandlers(run: MagickRun = magickRunner()): Handlers {
  /** Runs magick; a non-zero exit (but those in `ok`) is a failure: a usage error when its message says so. */
  const magick = async (args: string[], ok: number[] = [0]) => {
    const result = await run(args);
    // An unknown colour is only a warning to ImageMagick (it draws black): a usage error here
    const unknown = /unrecognized color `([^']*)'/.exec(result.stderr);
    if (unknown) throw new CliError(400, `Unrecognized color "${unknown[1]}"`, 'Give a colour name (magick -list color), #rrggbb[aa] or none');
    if (!ok.includes(result.code)) {
      const message = result.stderr.trim().split('\n')[0]?.replace(/ @ .*$/, '') || `magick exited with ${result.code}`;
      throw new CliError(USAGE_ERROR.test(message) ? 400 : 500, message, USAGE_ERROR.test(message) ? 'Check the file and the values given (magick-cli <command> --help)' : undefined);
    }
    return result;
  };

  const info = async (file: string): Promise<ImageInfo> => {
    const { stdout } = await magick(['identify', '-format', '%w|%h|%m|%[colorspace]|%[channels]|%z\n', input(file, true)]);
    const frames = stdout.trim().split('\n');
    const [w, h, format, colorspace, channels, depth] = frames[0].split('|');
    return { file, width: Number(w), height: Number(h), format, colorspace, alpha: /a$/.test(channels.trim().split(/\s+/)[0] ?? ''), depth: Number(depth), frames: frames.length };
  };

  /** Writes --out with `ops` between the input and it, and answers with what was written. */
  const write = async (inputs: string[], ops: string[], out: string, extra: Record<string, unknown> = {}) => {
    const file = output(out);
    await magick([...inputs, ...ops, file]);
    const { width, height, format } = await info(file);
    return { body: { file, width, height, format, ...extra }, text: `${file}\n` };
  };

  return {
    info: async ({ args }) => ({ body: await info(args.image) }),

    resize: async ({ args, flags }) => {
      if (Boolean(flags.size) === (flags.scale !== undefined)) throw new CliError(400, 'Give --size or --scale (one of them)');
      if (flags.scale !== undefined) return write([input(args.image)], ['-resize', `${flags.scale}%`], flags.out);
      const [w, h] = sizeOf(flags.size);
      const ops = { contain: ['-resize', `${w}x${h}`], cover: ['-resize', `${w}x${h}^`, '-gravity', 'center', '-extent', `${w}x${h}`], stretch: ['-resize', `${w}x${h}!`] }[flags.fit as 'contain' | 'cover' | 'stretch'];
      return write([input(args.image)], ops, flags.out);
    },

    crop: async ({ args, flags }) => {
      const [x, y, w, h] = (flags.rect as string).split(',').map(Number);
      const { width, height } = await info(args.image);
      if (!w || !h) throw new CliError(400, `--rect ${flags.rect}: width and height must be at least 1`);
      if (x >= width || y >= height) throw new CliError(400, `--rect ${flags.rect} is outside the ${width}x${height} image`);
      return write([input(args.image)], ['-crop', `${w}x${h}+${x}+${y}`, '+repage'], flags.out);
    },

    trim: async ({ args, flags }) => {
      const fuzz = ['-fuzz', `${flags.fuzz ?? 0}%`];
      const { stdout } = await magick([input(args.image), ...fuzz, '-format', '%@', 'info:']);
      const m = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)/.exec(stdout.trim());
      if (!m || m[1] === '0' || m[2] === '0') throw new CliError(400, `${args.image} is all one colour: trimming leaves nothing`, 'Lower --fuzz');
      const box = { x: Number(m[3]), y: Number(m[4]), width: Number(m[1]), height: Number(m[2]) };
      return write([input(args.image)], ['-crop', `${box.width}x${box.height}+${box.x}+${box.y}`, '+repage'], flags.out, { box });
    },

    pad: async ({ args, flags }) => {
      if (Boolean(flags.size) === (flags.margin !== undefined)) throw new CliError(400, 'Give --size or --margin (one of them)');
      const background = ['-background', flags.background];
      if (flags.margin !== undefined) return write([input(args.image)], ['-bordercolor', flags.background, '-compose', 'Copy', '-border', String(flags.margin)], flags.out);
      const [w, h] = sizeOf(flags.size);
      const { width, height } = await info(args.image);
      if (w < width || h < height) throw new CliError(400, `--size ${flags.size} is smaller than the ${width}x${height} image`, 'Crop or resize it first');
      return write([input(args.image)], [...background, '-gravity', flags.gravity, '-extent', `${w}x${h}`], flags.out);
    },

    convert: async ({ args, flags }) => {
      const ext = path.extname(flags.out).slice(1).toLowerCase();
      const background = flags.background ?? (ext === 'jpg' || ext === 'jpeg' ? 'white' : undefined);
      return write(
        [input(args.image)],
        [...(background ? ['-background', background, '-alpha', 'remove', '-alpha', 'off'] : []), ...(flags.quality ? ['-quality', String(flags.quality)] : []), ...(flags.strip ? ['-strip'] : [])],
        flags.out
      );
    },

    overlay: async ({ args, flags }) => {
      const [x, y] = pair(flags.at);
      const opacity = flags.opacity ?? 100;
      const top = opacity < 100 ? ['(', input(args.overlay), '-alpha', 'set', '-channel', 'A', '-evaluate', 'multiply', String(opacity / 100), '+channel', ')'] : [input(args.overlay)];
      return write([input(args.base), ...top], ['-gravity', flags.gravity, '-geometry', `${signed(x)}${signed(y)}`, '-compose', flags.blend, '-composite'], flags.out);
    },

    grid: async ({ flags }) => {
      const images = (flags.image as string[]).map((f) => input(f));
      const columns = flags.columns ?? Math.ceil(Math.sqrt(images.length));
      // montage puts its spacing on every side of every cell, so two cells are twice it apart: half the gap there,
      // and the rest framed around the whole grid (a second call: inside montage, -border frames each cell)
      const half = Math.floor(flags.gap / 2);
      const file = output(flags.out);
      await magick(['montage', ...images, '-tile', `${columns}x`, '-geometry', `+${half}+${half}`, '-background', flags.background, file]);
      const rest = flags.gap - half;
      if (rest) await magick([file, '-bordercolor', flags.background, '-compose', 'Copy', '-border', String(rest), file]);
      const { width, height, format } = await info(file);
      return { body: { file, width, height, format, columns, rows: Math.ceil(images.length / columns) }, text: `${file}\n` };
    },

    adjust: async ({ args, flags }) => {
      const ops: string[] = [];
      if (flags.brightness !== undefined || flags.saturation !== undefined || flags.hue !== undefined) {
        ops.push('-modulate', [flags.brightness ?? 100, flags.saturation ?? 100, 100 + ((flags.hue ?? 0) * 100) / 180].map((n) => String(Math.round(n * 100) / 100)).join(','));
      }
      if (flags.contrast !== undefined) ops.push('-brightness-contrast', `0x${flags.contrast}`);
      if (flags.gamma !== undefined) ops.push('-gamma', String(flags.gamma));
      if (flags.grayscale) ops.push('-colorspace', 'Gray');
      if (!ops.length) throw new CliError(400, 'Nothing to change: give --brightness, --saturation, --hue, --contrast, --gamma or --grayscale');
      return write([input(args.image)], ops, flags.out);
    },

    effect: async ({ args, flags }) => {
      const ops: string[] = [];
      if (flags.blur !== undefined) ops.push('-blur', `0x${flags.blur}`);
      if (flags.sharpen !== undefined) ops.push('-sharpen', `0x${flags.sharpen}`);
      if (flags.posterize !== undefined) ops.push('-posterize', String(flags.posterize));
      if (flags.sepia !== undefined) ops.push('-sepia-tone', `${flags.sepia}%`);
      if (flags.halftone !== undefined) ops.push('-ordered-dither', `h${flags.halftone}x${flags.halftone}a`);
      if (!ops.length) throw new CliError(400, 'No effect: give --blur, --sharpen, --posterize, --sepia or --halftone');
      return write([input(args.image)], ops, flags.out);
    },

    transparent: async ({ args, flags }) => {
      const fuzz = ['-alpha', 'set', '-fuzz', `${flags.fuzz}%`];
      const points = (flags.at ?? []) as string[];
      if (!points.length) return write([input(args.image)], [...fuzz, '-transparent', flags.color], flags.out);
      const { width, height } = await info(args.image);
      const draws = points.flatMap((p) => {
        const [x, y] = pair(p);
        if (x < 0 || y < 0 || x >= width || y >= height) throw new CliError(400, `--at ${p} is outside the ${width}x${height} image`);
        return ['-draw', `color ${x},${y} floodfill`];
      });
      return write([input(args.image)], [...fuzz, '-fill', 'none', ...draws], flags.out);
    },

    compare: async ({ args }) => {
      const [a, b] = [await info(args.a), await info(args.b)];
      if (a.width !== b.width || a.height !== b.height) throw new CliError(400, `The images differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}`, 'Resize or crop one to the other first');
      // compare exits 1 when the images differ, and prints the metric on stderr: "<absolute> (<normalized>)"
      const { stderr } = await magick(['compare', '-metric', 'RMSE', input(args.a), input(args.b), 'null:'], [0, 1]);
      const m = /\(([\d.e+-]+)\)/.exec(stderr);
      if (!m) throw new CliError(500, `compare printed no difference: ${stderr.trim()}`);
      const rmse = Number(m[1]);
      return { body: { a: args.a, b: args.b, rmse, same: rmse === 0 } };
    },
  };
}

/** The handlers, as the launcher takes them. */
export const handlers = (): Handlers => magickHandlers();
