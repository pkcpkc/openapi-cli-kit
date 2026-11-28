import type { CliDef, FlagDef, OpDef } from 'openapi-cli-kit';

/**
 * `magick-cli`: ImageMagick 7 (`magick`) on image files, as typed commands. Each command is one or two `magick` calls on
 * the machine (no shell), quick and exact: sizes, crops, borders, formats, compositing, grids, colours, effects,
 * transparency, comparing two versions.
 */

const imageArg = (name = 'image', what = 'The image file') => ({ name, description: `${what} (PNG, JPEG, WebP, …)`, schema: { type: 'string', format: 'path' } });
const out: FlagDef = { name: '--out', short: '-o', description: 'Where to write the result; its extension sets the format (png, jpg, webp, gif, tif, bmp)', required: true, schema: { type: 'string', format: 'path' } };

export const SIZE_PATTERN = '^\\d+x\\d+$';
export const POINT_PATTERN = '^-?\\d+,-?\\d+$';
export const PIXEL_RECT_PATTERN = '^\\d+,\\d+,\\d+,\\d+$';
export const GRAVITIES = ['center', 'north', 'south', 'east', 'west', 'northwest', 'northeast', 'southwest', 'southeast'];
export const BLENDS = ['over', 'multiply', 'screen', 'darken', 'lighten', 'overlay'];

const size = (description: string): FlagDef => ({ name: '--size', short: '-s', description, schema: { type: 'string', pattern: SIZE_PATTERN } });
const gravity = (fallback: string, description: string): FlagDef => ({ name: '--gravity', short: '-g', description, schema: { enum: GRAVITIES, default: fallback } });
const color = (name: `--${string}`, fallback: string, description: string): FlagDef => ({ name, description: `${description}: a colour name, #rrggbb[aa] or none`, schema: { type: 'string', default: fallback } });
const percent = (name: `--${string}`, description: string, min = 0, max = 100): FlagDef => ({ name, description, schema: { type: 'number', minimum: min, maximum: max } });

const fileResult = {
  type: 'object',
  required: ['file', 'width', 'height', 'format'],
  properties: {
    file: { type: 'string', description: 'The absolute path written' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    format: { type: 'string', description: 'PNG, JPEG, WEBP, …' },
  },
};

/** A command that writes one image: a POST that changes nothing but the file at --out. */
const writes = (op: Omit<OpDef, 'method' | 'result' | 'conflicts'> & { result?: OpDef['result'] }): OpDef => ({
  method: 'post',
  conflicts: false,
  result: { description: 'The image written, with its size', schema: 'File' },
  ...op,
  flags: [...(op.flags ?? []), out],
});

export const cli: CliDef = {
  binary: 'magick-cli',
  version: '1.0.0',
  summary: 'Exact pixel work on image files with ImageMagick: size, crop, trim, pad, convert, overlay, grid, colour, effects, transparency, compare.',
  description: `Each command is a typed wrapper of ImageMagick 7 (\`magick\` on the PATH, or MAGICK_BINARY): it reads the images
at the paths you give and writes the result to --out, its format from the extension. Nothing but ImageMagick runs, so it is
quick and exact, and the same input gives the same pixels. Pixel numbers are pixels of the input image, x to the right
and y down from its top-left corner. Use it to measure, fit and assemble images; it never invents pixels.`,
  examples: [
    'magick-cli info panel.png --json | jq .width',
    'magick-cli resize robot.png --size 512x512 --fit cover -o robot_512.png',
    'magick-cli crop alley.png --rect 310,200,400,610 -o robot.png',
    'magick-cli trim sticker.png --fuzz 5 -o sticker_tight.png --json | jq .box',
    'magick-cli transparent sheet.png --at 0,0 --fuzz 8 -o sheet_cut.png',
    'magick-cli overlay alley.png robot_cut.png --at 560,300 -o composed.png',
    'magick-cli grid --image p1.png --image p2.png --image p3.png --image p4.png --columns 2 --gap 8 --background white -o page.png',
    'magick-cli compare before.png after.png --json | jq .rmse',
  ],
  schemas: {
    File: fileResult,
    Info: {
      type: 'object',
      required: ['file', 'width', 'height', 'format'],
      properties: {
        file: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        format: { type: 'string' },
        colorspace: { type: 'string', description: 'sRGB, Gray, CMYK, …' },
        alpha: { type: 'boolean', description: 'It has an alpha channel (transparency)' },
        depth: { type: 'integer', description: 'Bits per channel' },
        frames: { type: 'integer', description: 'Frames (more than 1 for an animation)' },
      },
    },
    Trimmed: { ...fileResult, properties: { ...fileResult.properties, box: { type: 'object', description: 'Where the kept part was in the input, in pixels', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } } } } },
    Comparison: {
      type: 'object',
      required: ['rmse', 'same'],
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        rmse: { type: 'number', description: 'Root mean square difference, 0 (the same) to 1' },
        same: { type: 'boolean', description: 'The pixels are identical' },
      },
    },
  },
  ops: [
    {
      id: 'info',
      cmd: 'info',
      method: 'get',
      summary: "An image's size, format, colour space, alpha, depth and frames",
      args: [imageArg()],
      result: { description: 'What the image is', schema: 'Info' },
    },
    writes({
      id: 'resize',
      cmd: 'resize',
      summary: 'Scale an image to --size (as --fit says) or by --scale percent',
      args: [imageArg()],
      flags: [
        size('WIDTHxHEIGHT to fit it to'),
        percent('--scale', 'Scale by this percent instead (50 halves it)', 1, 1000),
        { name: '--fit', description: 'contain: inside the size, aspect kept; cover: fills it, aspect kept, the overflow cut off around the centre; stretch: exactly the size', schema: { enum: ['contain', 'cover', 'stretch'], default: 'contain' } },
      ],
    }),
    writes({
      id: 'crop',
      cmd: 'crop',
      summary: 'Cut out a rectangle',
      args: [imageArg()],
      flags: [{ name: '--rect', description: 'x,y,width,height in pixels (a part past the edge is cut off)', required: true, schema: { type: 'string', pattern: PIXEL_RECT_PATTERN } }],
    }),
    writes({
      id: 'trim',
      cmd: 'trim',
      summary: 'Cut off the borders of one colour (or transparency); reports where the rest was',
      args: [imageArg()],
      flags: [percent('--fuzz', 'How far a colour may differ from the border colour and still count as border, in percent')],
      result: { description: 'The image written, and its box in the input', schema: 'Trimmed' },
    }),
    writes({
      id: 'pad',
      cmd: 'pad',
      summary: 'Extend the canvas to --size, or by --margin on every side (a panel border, a frame)',
      args: [imageArg()],
      flags: [
        size('WIDTHxHEIGHT of the canvas, at least the image'),
        { name: '--margin', short: '-m', description: 'Pixels to add on every side instead', schema: { type: 'integer', minimum: 1 } },
        gravity('center', 'Where the image sits on a --size canvas'),
        color('--background', 'none', 'The added area'),
      ],
    }),
    writes({
      id: 'convert',
      cmd: 'convert',
      summary: 'Write an image in another format (from the extension of --out)',
      args: [imageArg()],
      flags: [
        { name: '--quality', short: '-q', description: 'JPEG / WebP quality', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: '--background', description: 'Flatten transparency onto this colour (JPEG, which has none: white unless given)' },
        { name: '--strip', description: 'Drop the metadata (EXIF, profiles, comments)', schema: { type: 'boolean', default: false } },
      ],
    }),
    writes({
      id: 'overlay',
      cmd: 'overlay',
      summary: 'Put one image on another (a cut-out on a background, inks over colours)',
      args: [imageArg('base', 'The image below'), imageArg('overlay', 'The image on top, its transparency kept')],
      flags: [
        { name: '--at', description: 'x,y offset of the overlay in pixels, from where --gravity puts it', schema: { type: 'string', pattern: POINT_PATTERN, default: '0,0' } },
        gravity('northwest', 'The corner or side --at counts from'),
        percent('--opacity', 'Opacity of the overlay, in percent (100: as it is)'),
        { name: '--blend', short: '-b', description: 'How its colours mix with the base', schema: { enum: BLENDS, default: 'over' } },
      ],
    }),
    {
      ...writes({
        id: 'grid',
        cmd: 'grid',
        summary: 'Lay images out in a grid, left to right and top to bottom (a page, a contact sheet)',
        flags: [
          { name: '--image', short: '-i', description: 'An image, in reading order', required: true, schema: { type: 'array', items: { type: 'string', format: 'path' } } },
          { name: '--columns', short: '-c', description: 'Images per row (default: a square-ish grid)', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: '--gap', description: 'Pixels between images and around the grid', schema: { type: 'integer', minimum: 0, default: 0 } },
          color('--background', 'none', 'The gaps and the space around smaller images (each cell is the size of the largest)'),
        ],
      }),
      missing: true,
    },
    writes({
      id: 'adjust',
      cmd: 'adjust',
      summary: 'Change brightness, saturation, hue, contrast, gamma, or make it grey',
      args: [imageArg()],
      flags: [
        percent('--brightness', 'Brightness in percent (100: unchanged)', 0, 400),
        percent('--saturation', 'Saturation in percent (100: unchanged, 0: grey)', 0, 400),
        { name: '--hue', description: 'Turn the hues by degrees', schema: { type: 'number', minimum: -180, maximum: 180 } },
        { name: '--contrast', description: 'Contrast, -100 (flat) to 100', schema: { type: 'number', minimum: -100, maximum: 100 } },
        { name: '--gamma', description: 'Gamma (1: unchanged, above 1: lighter mid-tones)', schema: { type: 'number', minimum: 0.1, maximum: 10 } },
        { name: '--grayscale', description: 'Make it grey', schema: { type: 'boolean', default: false } },
      ],
    }),
    writes({
      id: 'effect',
      cmd: 'effect',
      summary: 'Blur, sharpen, posterize, sepia or a halftone screen, in that order',
      args: [imageArg()],
      flags: [
        { name: '--blur', description: 'Gaussian blur radius in pixels', schema: { type: 'number', minimum: 0.1, maximum: 100 } },
        { name: '--sharpen', description: 'Sharpen radius in pixels', schema: { type: 'number', minimum: 0.1, maximum: 20 } },
        { name: '--posterize', description: 'Levels per channel (flat, print-like colours)', schema: { type: 'integer', minimum: 2, maximum: 64 } },
        percent('--sepia', 'Sepia tone threshold, in percent (80 is typical)'),
        { name: '--halftone', description: 'A halftone dot screen of this cell size in pixels', schema: { type: 'integer', enum: [4, 6, 8] } },
      ],
    }),
    writes({
      id: 'transparent',
      cmd: 'transparent',
      summary: 'Make a colour transparent: everywhere, or only the area connected to --at points (a background)',
      args: [imageArg()],
      flags: [
        color('--color', 'white', 'The colour to clear (without --at)'),
        { name: '--at', description: 'x,y of a pixel of the area to clear, its colour taken from there (repeatable); the same colour elsewhere stays', schema: { type: 'array', items: { type: 'string', pattern: POINT_PATTERN } } },
        { ...percent('--fuzz', 'How far a colour may differ and still be cleared, in percent'), schema: { type: 'number', minimum: 0, maximum: 100, default: 10 } },
      ],
    }),
    {
      id: 'compare',
      cmd: 'compare',
      method: 'get',
      summary: 'How different two images of the same size are',
      args: [imageArg('a', 'One image'), imageArg('b', 'The other, the same size')],
      result: { description: 'The difference', schema: 'Comparison' },
    },
  ],
};
