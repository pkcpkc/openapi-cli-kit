import type { Handlers } from 'openapi-cli-kit';
import { CliError } from 'openapi-cli-kit';
import { batch, quotePython, type GimpRun } from './runtime.ts';
import { parsePair, parseRect, parseSize, prepareOutput, requireFile } from './shared.ts';

export function imageHandlers(run: GimpRun): Handlers {
  return {
    'image-info': async ({ args }) => {
      const file = args.image as string;
      requireFile(file);
      const body = await batch(run, `image = load_image(${quotePython(file)})
emit(image_info(image, ${quotePython(file)}))`);
      return { body };
    },
    'image-import': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
ensure_root(image)
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-export': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file]);
      const body = await batch(run, `image = load_image(${quotePython(file)})
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-assemble': async ({ flags }) => {
      const files = flags.layer as string[];
      const output = flags.out as string;
      files.forEach(requireFile);
      prepareOutput(output, files, true);
      const body = await batch(run, `files = ${JSON.stringify(files)}
image = load_image(files[0])
root = ensure_root(image)
base_layers = sequence(root.get_children())
if len(base_layers) == 1 and base_layers[0].get_name() == "Background":
    base_name = Gio.File.new_for_path(files[0]).get_basename()
    if base_name:
        base_layers[0].set_name(base_name.rsplit(".", 1)[0] if "." in base_name else base_name)
for filename in files[1:]:
    layer = Gimp.file_load_layer(Gimp.RunMode.NONINTERACTIVE, image, Gio.File.new_for_path(filename))
    if layer is None:
        raise CliFailure(400, "GIMP could not load layer " + filename)
    if not image.insert_layer(layer, root, 0):
        raise CliFailure(500, "GIMP could not insert layer " + filename)
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-resize': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      const [width, height] = parseSize(flags.size as string);
      requireFile(file);
      prepareOutput(output, [file]);
      const body = await batch(run, `image = load_image(${quotePython(file)})
if not image.scale(${width}, ${height}):
    raise CliFailure(400, "GIMP could not scale the image")
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-crop': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      const [x, y, width, height] = parseRect(flags.rect as string);
      requireFile(file);
      prepareOutput(output, [file]);
      const body = await batch(run, `image = load_image(${quotePython(file)})
if not image.crop(${width}, ${height}, ${x}, ${y}):
    raise CliFailure(400, "Crop rectangle is outside the image bounds")
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-transform': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      const rotation = flags.rotate as number | undefined;
      const flip = flags.flip as string | undefined;
      if (rotation === undefined && flip === undefined) throw new CliError(400, 'Specify --rotate, --flip, or both');
      requireFile(file);
      prepareOutput(output, [file]);
      const rotateCode = rotation === undefined ? '' : `if not image.rotate(Gimp.RotationType.DEGREES${rotation}):
    raise CliFailure(400, "GIMP could not rotate the image")
`;
      const flipCode = flip === undefined ? '' : `if not image.flip(Gimp.OrientationType.${flip.toUpperCase()}):
    raise CliFailure(400, "GIMP could not flip the image")
`;
      const body = await batch(run, `image = load_image(${quotePython(file)})
${rotateCode}${flipCode}emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-flatten': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file]);
      const body = await batch(run, `image = load_image(${quotePython(file)})
if image.flatten() is None:
    raise CliFailure(400, "GIMP could not flatten the image")
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-watermark': async ({ args, flags }) => {
      const file = args.image as string;
      const logo = flags.logo as string;
      const output = flags.out as string;
      const [x, y] = parsePair(flags.at as string, '--at');
      const opacity = flags.opacity as number;
      requireFile(file);
      requireFile(logo);
      prepareOutput(output, [file, logo], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
layer = Gimp.file_load_layer(Gimp.RunMode.NONINTERACTIVE, image, Gio.File.new_for_path(${quotePython(logo)}))
if layer is None:
    raise CliFailure(400, "GIMP could not load watermark " + ${quotePython(logo)})
root = ensure_root(image)
if not image.insert_layer(layer, root, 0):
    raise CliFailure(500, "GIMP could not insert watermark layer")
layer.set_offsets(${x}, ${y})
layer.set_opacity(${opacity})
layer.set_name("Watermark")
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'image-text-add': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      const [x, y] = parsePair(flags.at as string, '--at');
      const text = flags.text as string;
      const font = flags.font as string;
      const size = flags.size as number;
      const color = flags.color as string;
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `import gi
gi.require_version("Gegl", "0.4")
from gi.repository import Gegl
image = load_image(${quotePython(file)})
root = ensure_root(image)
if ${quotePython(font)} == "auto":
    fonts = sequence(Gimp.fonts_get_list(None))
    font = fonts[0] if fonts else None
else:
    font = Gimp.Font.get_by_name(${quotePython(font)})
if font is None:
    raise CliFailure(400, "GIMP has no loaded font named " + ${quotePython(font)})
layer = Gimp.TextLayer.new(image, ${quotePython(text)}, font, ${size}, Gimp.Unit.pixel())
if layer is None:
    raise CliFailure(400, "GIMP could not create the text layer")
layer.set_color(Gegl.Color.new(${quotePython(color)}))
if not image.insert_layer(layer, root, 0):
    raise CliFailure(500, "GIMP could not insert the text layer")
layer.set_offsets(${x}, ${y})
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    }
  };
}
