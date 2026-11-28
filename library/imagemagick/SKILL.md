---
name: magick-cli
description: Exact, quick pixel work on image files with ImageMagick through the `magick-cli` CLI. It reads an image's size and format, resizes, crops, trims borders, pads or frames, converts formats, overlays one image on another, lays images out in a grid, adjusts colours, applies effects (blur, posterize, halftone), clears a background to transparency, and compares two images. Use it to measure, fit and assemble images, such as trimming a cut-out, putting a figure on a background, making a contact sheet or a page, or checking whether an edit changed anything.
---

# magick-cli: ImageMagick on image files

`magick-cli` wraps ImageMagick 7 (`magick` on the PATH, or `MAGICK_BINARY`) as typed commands. Each command reads
images at the paths you give and writes `--out` (`-o`). The extension of `--out` sets the format. No model and no
server are involved, so each call takes well under a second and gives the same pixels every time. The commands are
listed in [references/commands.md](references/commands.md), and `magick-cli <command> --help` shows one command.

## When to use it, and when not

- **Use it** for exact geometry and colour: sizes, crops, borders, canvases, offsets, formats, grids, transparency,
  and checking whether an edit changed anything.
- **Don't use it** to draw or change content: that is an image model's job. `transparent` clears a flat colour; it
  does not find objects (a segmentation model does).
- For anything these commands don't cover, call `magick` directly.

## What each command does

- **info** reads the size, format, colour space, alpha, depth and frame count. It only reads, so start with it: every
  pixel number elsewhere is in pixels of the input, x to the right and y down from the top-left corner.
- **resize** takes `--size WxH` with `--fit contain` (inside the box, aspect kept), `cover` (fills the box, the
  overflow cut around the centre) or `stretch`. `--scale 50` scales by percent instead.
- **crop** cuts `--rect x,y,width,height`.
- **trim** cuts off a border of one colour, or a transparent one; `--fuzz` is in percent. It reports `box`, where the
  kept part was in the input, so you can put it back with `overlay --at box.x,box.y`.
- **pad** grows the canvas to `--size` (placed by `--gravity`), or by `--margin` px on every side. With
  `--background black` it makes a panel border.
- **convert** rewrites the image in the format of `--out`, with `--quality` and `--strip` (drop metadata). A JPEG has
  no transparency, so it is flattened onto white unless you pass `--background`.
- **overlay** puts `<overlay>` on `<base>` at `--at x,y`, counted from `--gravity` (default: the top-left corner).
  `--opacity` is in percent; `--blend` is `over`, `multiply` (inks over colours), `screen`, `darken`, `lighten` or
  `overlay`. The result has the base's size.
- **grid** lays the `--image`s out in reading order, `--columns` per row, `--gap` px between them and around the edge.
  Each cell takes the size of the largest image, so make the images the same size first for an even page.
- **adjust** changes colour: `--brightness` and `--saturation` in percent (100 leaves them as they are), `--hue` in
  degrees, `--contrast` from -100 to 100, `--gamma`, and `--grayscale`.
- **effect** applies, in this order, `--blur`, `--sharpen` (both radii in px), `--posterize` (levels), `--sepia` and
  `--halftone 4|6|8` (a print dot screen).
- **transparent** clears `--color` (default white) everywhere, within `--fuzz` percent. With `--at x,y` (repeatable),
  it clears only the area connected to that pixel, taking the colour from there. Use `--at` for a background, so the
  same colour inside the subject (white eyes, white shirt) stays.
- **compare** checks two images of the same size. It reports `rmse` (0 means identical, 1 means as different as
  possible) and `same`. It only reads.

## Rules

- Add `--json` and read `file`, `width` and `height` from the result. **Open the image to check it** when its look
  matters.
- Exit codes:
  - 0: done.
  - 1: usage error, such as a bad value, a colour ImageMagick doesn't know, an area outside the image, or a file that
    isn't an image.
  - 2: a file is missing.
  - 4: ImageMagick isn't installed. Tell the user: `brew install imagemagick`.
  - 5: ImageMagick failed.
- Write results to new files. Keep the original, so you can compare against it and start over.
- Only the first frame of an animation is used, except by `info`, which counts the frames.
- Image models often want sizes in multiples of 32 or 64: `resize --fit cover` to such a size (1024x1024,
  1344x768) before handing an image to one.

## Recipes

```bash
# Look first
magick-cli info sheet.png --json

# A figure from a white sheet as a tight transparent cut-out, then onto a background
magick-cli transparent sheet.png --at 0,0 --fuzz 8 -o sheet_clear.png --json
magick-cli trim sheet_clear.png -o robot.png --json
magick-cli overlay alley.png robot.png --at 560,300 -o composed.png --json

# Fit a photo to a size, then frame it
magick-cli resize photo.jpg --size 1344x768 --fit cover -o photo_1344.png --json
magick-cli pad panel.png --margin 12 --background black -o panel_framed.png --json

# A page of four images, then a web copy
magick-cli grid -i p1.png -i p2.png -i p3.png -i p4.png --columns 2 --gap 16 --background white -o page.png --json
magick-cli convert page.png -o page.jpg --quality 85 --strip --json

# A printed look
magick-cli effect panel.png --posterize 6 --halftone 6 -o panel_print.png --json
magick-cli adjust panel.png --saturation 130 --contrast 15 -o panel_punchy.png --json

# Did the edit change anything?
magick-cli compare before.png after.png --json
```
