import type { Handlers } from 'openapi-cli-kit';
import { batch, quotePython, type GimpRun } from './runtime.ts';
import { CliError } from 'openapi-cli-kit';
import fs from 'node:fs';
import path from 'node:path';
import { prepareOutput, requireFile } from './shared.ts';

export function layerHandlers(run: GimpRun): Handlers {
  return {
    'image-effect': async ({ args, flags }) => {
      const file = args.image as string;
      const output = flags.out as string;
      const preset = flags.preset as string;
      const amount = flags.amount as number | undefined;
      const layerPath = flags.layer as string | undefined;
      if (preset !== 'grayscale' && amount === undefined) throw new CliError(400, `--amount is required for the ${preset} effect`);
      requireFile(file);
      prepareOutput(output, [file], true);
      const operation = preset === 'blur' ? 'gegl:gaussian-blur' : preset === 'sharpen' ? 'gegl:unsharp-mask' : 'gimp:desaturate';
      const filterName = preset === 'blur' ? 'Gaussian Blur' : preset === 'sharpen' ? 'Unsharp Mask' : 'Grayscale';
      const configCode =
        preset === 'blur'
          ? `config.set_property("std-dev-x", ${amount})
config.set_property("std-dev-y", ${amount})`
          : preset === 'sharpen'
            ? `config.set_property("std-dev", ${amount})
config.set_property("scale", 1.0)
config.set_property("threshold", 0.0)`
            : '';
      const body = await batch(run, `image = load_image(${quotePython(file)})
if ${layerPath === undefined ? 'True' : 'False'}:
    roots = [layer for layer in sequence(image.get_layers()) if isinstance(layer, Gimp.GroupLayer) and layer.get_name() == "Root"]
    candidates = sequence(roots[0].get_children()) if roots else sequence(image.get_layers())
    candidates = [layer for layer in candidates if layer.get_visible()]
    if not candidates:
        raise CliFailure(400, "The root group has no visible layer or group")
    layer = candidates[0]
else:
    layer = find_item(image, ${quotePython(layerPath ?? '')})
available = sequence(Gimp.DrawableFilter.operation_get_available())
if ${quotePython(operation)} not in available:
    raise CliFailure(400, "This GIMP installation does not provide the GEGL operation ${operation}")
filter = Gimp.DrawableFilter.new(layer, ${quotePython(operation)}, ${quotePython(filterName)})
if filter is None:
    raise CliFailure(400, "GIMP could not create the ${filterName} filter")
config = filter.get_config()
${configCode ? `${configCode}\n` : ''}filter.update()
layer.append_filter(filter)
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-list': async ({ args }) => {
      const file = args.image as string;
      requireFile(file);
      const body = await batch(run, `image = load_image(${quotePython(file)})
emit(image_info(image, ${quotePython(file)}))`);
      return { body };
    },
    'layers-add': async ({ args, flags }) => {
      const file = args.image as string;
      const layers = flags.layer as string[];
      const groupPath = flags.group as string;
      const output = flags.out as string;
      requireFile(file);
      layers.forEach(requireFile);
      prepareOutput(output, [file, ...layers], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
ensure_root(image)
parent = find_group(image, ${quotePython(groupPath)})
for filename in ${JSON.stringify(layers)}:
    layer = Gimp.file_load_layer(Gimp.RunMode.NONINTERACTIVE, image, Gio.File.new_for_path(filename))
    if layer is None:
        raise CliFailure(400, "GIMP could not load layer " + filename)
    if not image.insert_layer(layer, parent, 0):
        raise CliFailure(500, "GIMP could not insert layer " + filename)
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-set': async ({ args, flags }) => {
      const file = args.image as string;
      const layerPath = args.layer as string;
      const output = flags.out as string;
      const newName = flags.name as string | undefined;
      const visible = flags.visible as boolean | undefined;
      const opacity = flags.opacity as number | undefined;
      if (newName === undefined && visible === undefined && opacity === undefined) throw new CliError(400, 'Specify at least one of --name, --visible, or --opacity');
      requireFile(file);
      prepareOutput(output, [file], true);
      const changes = [
        newName === undefined ? '' : `layer.set_name(${quotePython(newName)})`,
        visible === undefined ? '' : `layer.set_visible(${visible ? 'True' : 'False'})`,
        opacity === undefined ? '' : `layer.set_opacity(${opacity})`,
      ].filter(Boolean).join('\n');
      const body = await batch(run, `image = load_image(${quotePython(file)})
layer = find_item(image, ${quotePython(layerPath)})
${changes}
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-show': async ({ args, flags }) => {
      const file = args.image as string;
      const layerPath = args.layer as string;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
item = find_item(image, ${quotePython(layerPath)})
item.set_visible(True)
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-hide': async ({ args, flags }) => {
      const file = args.image as string;
      const layerPath = args.layer as string;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
item = find_item(image, ${quotePython(layerPath)})
item.set_visible(False)
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-mask-add': async ({ args, flags }) => {
      const file = args.image as string;
      const layerPath = args.layer as string;
      const output = flags.out as string;
      const maskType = flags.type as string;
      const enums: Record<string, string> = {
        white: 'WHITE',
        black: 'BLACK',
        alpha: 'ALPHA',
        'alpha-transfer': 'ALPHA_TRANSFER',
        copy: 'COPY',
      };
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
layer = find_item(image, ${quotePython(layerPath)})
mask = layer.create_mask(Gimp.AddMaskType.${enums[maskType]})
if mask is None or not layer.add_mask(mask):
    raise CliFailure(400, "GIMP could not add a ${maskType} mask to " + ${quotePython(layerPath)})
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-group': async ({ args, flags }) => {
      const file = args.image as string;
      const layers = flags.layer as string[];
      const name = flags.name as string;
      const output = flags.out as string;
      if (!name || name.includes('/')) throw new CliError(400, '--name must be a non-empty group name without /');
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
items = [find_item(image, item_path_value) for item_path_value in ${JSON.stringify(layers)}]
if len(set(item.get_id() for item in items)) != len(items):
    raise CliFailure(400, "A layer/group was selected more than once")
parent, siblings = parent_and_siblings(image, items[0])
if any(item.get_parent() != parent for item in items):
    raise CliFailure(400, "All selected layers/groups must have the same parent; use layers move first")
if any(item.get_name() == ${quotePython(name)} for item in siblings):
    raise CliFailure(400, "A layer/group named " + ${quotePython(name)} + " already exists in this group")
ordered = [item for item in siblings if item in items]
position = min(siblings.index(item) for item in ordered)
group = Gimp.GroupLayer.new(image, ${quotePython(name)})
if group is None or not image.insert_layer(group, parent, position):
    raise CliFailure(500, "GIMP could not create group " + ${quotePython(name)})
for index, item in enumerate(ordered):
    if not image.reorder_item(item, group, index):
        raise CliFailure(500, "GIMP could not move " + item.get_name() + " into the new group")
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-merge': async ({ args, flags }) => {
      const file = args.image as string;
      const layers = flags.layer as string[];
      const name = flags.name as string;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
items = [find_item(image, item_path_value) for item_path_value in ${JSON.stringify(layers)}]
if len(set(item.get_id() for item in items)) != len(items):
    raise CliFailure(400, "A layer/group was selected more than once")
if len(items) == 1 and not isinstance(items[0], Gimp.GroupLayer):
    raise CliFailure(400, "Select at least two sibling layers, or one group to merge")
if len(items) == 1 and isinstance(items[0], Gimp.GroupLayer):
    merged = items[0].merge()
else:
    parent, siblings = parent_and_siblings(image, items[0])
    if any(item.get_parent() != parent for item in items):
        raise CliFailure(400, "Selected layers/groups must have the same parent")
    ordered = [item for item in siblings if item in items]
    if len(ordered) != len(items):
        raise CliFailure(400, "Could not resolve all selected layer/group paths")
    position = min(siblings.index(item) for item in ordered)
    group = Gimp.GroupLayer.new(image, ${quotePython(name)})
    if group is None or not image.insert_layer(group, parent, position):
        raise CliFailure(500, "GIMP could not create a temporary merge group")
    for index, item in enumerate(ordered):
        visible_item(image, item)
        if not image.reorder_item(item, group, index):
            raise CliFailure(500, "GIMP could not move " + item.get_name() + " into the merge group")
    merged = group.merge()
if merged is None:
    raise CliFailure(400, "GIMP could not merge the selected layer/group contents")
merged.set_name(${quotePython(name)})
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-group-add': async ({ args, flags }) => {
      const file = args.image as string;
      const name = flags.name as string;
      const parentPath = flags.parent as string;
      const index = flags.index as number;
      requireFile(file);
      if (!name || name.includes('/')) throw new CliError(400, '--name must be a non-empty group name without /');
      prepareOutput(flags.out as string, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
root = ensure_root(image)
parent = find_group(image, ${quotePython(parentPath)})
if any(item.get_name() == ${quotePython(name)} for item in sequence(parent.get_children())):
    raise CliFailure(400, "A layer/group named " + ${quotePython(name)} + " already exists in " + ${quotePython(parentPath)})
group = Gimp.GroupLayer.new(image, ${quotePython(name)})
if group is None or not image.insert_layer(group, parent, ${index}):
    raise CliFailure(500, "GIMP could not create group " + ${quotePython(name)})
emit(save_result(image, ${quotePython(flags.out as string)}))`);
      return { body };
    },
    'layers-move': async ({ args, flags }) => {
      const file = args.image as string;
      const layerPath = args.layer as string;
      const targetPath = flags.to as string;
      const index = flags.index as number;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
item = find_item(image, ${quotePython(layerPath)})
parent = find_group(image, ${quotePython(targetPath)})
if not image.reorder_item(item, parent, ${index}):
    raise CliFailure(400, "GIMP could not move " + ${quotePython(layerPath)} + " into " + ${quotePython(targetPath)})
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'layers-delete': async ({ args, flags }) => {
      const file = args.image as string;
      const layerPath = args.layer as string;
      const output = flags.out as string;
      requireFile(file);
      prepareOutput(output, [file], true);
      const body = await batch(run, `image = load_image(${quotePython(file)})
item = find_item(image, ${quotePython(layerPath)})
if not image.remove_layer(item):
    raise CliFailure(400, "GIMP could not delete " + ${quotePython(layerPath)})
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    },
    'paths-export': async ({ args, flags }) => {
      const file = args.image as string;
      const directory = path.resolve(flags.dir as string);
      requireFile(file);
      fs.mkdirSync(directory, { recursive: true });
      const body = await batch(run, `import re
image = load_image(${quotePython(file)})
files = []
for index, item in enumerate(sequence(image.get_paths()), 1):
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", item.get_name()).strip("-.") or "path"
    output = ${quotePython(directory)} + "/" + str(index).zfill(2) + "-" + name + ".svg"
    if not image.export_path_to_file(Gio.File.new_for_path(output), item):
        raise CliFailure(500, "GIMP could not export path " + item.get_name())
    files.append(output)
emit({"directory": ${quotePython(directory)}, "files": files})`);
      return { body };
    }
  };
}
