import type { Handlers } from 'openapi-cli-kit';
import { batch, quotePython, type GimpRun } from './runtime.ts';
import { CliError } from 'openapi-cli-kit';
import fs from 'node:fs';
import path from 'node:path';
import { prepareOutput, requireFile } from './shared.ts';

export function bundleHandlers(run: GimpRun): Handlers {
  return {
    'layers-export': async ({ args, flags }) => {
      const file = args.image as string;
      const layerPath = args.layer as string;
      const directory = path.resolve(flags.dir as string);
      requireFile(file);
      fs.mkdirSync(directory, { recursive: true });
      const imageFile = path.join(directory, 'layer.png');
      const xcfFile = path.join(directory, 'layer.xcf');
      const manifestFile = path.join(directory, 'manifest.json');
      const body = await batch(run, `import os
image = load_image(${quotePython(file)})
item = find_item(image, ${quotePython(layerPath)})
manifest_item = layer_info(item, item.get_parent().get_name() if item.get_parent() is not None else "")
editable = image.duplicate()
editable_item = find_item(editable, ${quotePython(layerPath)})
visible_item(editable, editable_item)
isolate_item(editable, editable_item)
save_image(editable, ${quotePython(xcfFile)})
render = image.duplicate()
render_item = find_item(render, ${quotePython(layerPath)})
visible_item(render, render_item)
render_item.set_opacity(100.0)
if render_item.get_mask() is not None:
    render_item.set_apply_mask(False)
isolate_item(render, render_item)
save_image(render, ${quotePython(imageFile)})
os.makedirs(os.path.join(${quotePython(directory)}, "masks"), exist_ok=True)
masks = []
def export_masks(item, item_path_value):
    mask = item.get_mask()
    if mask is not None:
        filename = "masks/mask-" + str(len(masks) + 1).zfill(2) + ".png"
        full_path = os.path.join(${quotePython(directory)}, filename)
        if export_mask(image, item_path_value, full_path):
            masks.append({
                "file": filename,
                "layerPath": item_path_value,
                "name": mask.get_name(),
                "visible": mask.get_visible(),
                "opacity": mask.get_opacity(),
                "showMask": item.get_show_mask(),
                "applyMask": item.get_apply_mask(),
                "editMask": item.get_edit_mask(),
            })
    if isinstance(item, Gimp.GroupLayer):
        for child in sequence(item.get_children()):
            export_masks(child, item_path(item_path_value, child))
export_masks(item, ${quotePython(layerPath)})
manifest = {
    "formatVersion": 1,
    "image": {"width": image.get_width(), "height": image.get_height()},
    "render": {"x": 0, "y": 0},
    "sourcePath": ${quotePython(layerPath)},
    "item": manifest_item,
    "masks": masks,
}
with open(${quotePython(manifestFile)}, "w", encoding="utf-8") as stream:
    json.dump(manifest, stream, ensure_ascii=False, indent=2)
emit({"directory": ${quotePython(directory)}, "image": ${quotePython(imageFile)}, "xcf": ${quotePython(xcfFile)}, "manifest": ${quotePython(manifestFile)}, "masks": [os.path.join(${quotePython(directory)}, entry["file"]) for entry in masks]})`);
      return { body };
    },
    'layers-import': async ({ args, flags }) => {
      const file = args.image as string;
      const directory = path.resolve(flags.bundle as string);
      const imageFile = path.join(directory, 'layer.png');
      const xcfFile = path.join(directory, 'layer.xcf');
      const manifestFile = path.join(directory, 'manifest.json');
      const output = flags.out as string;
      const groupPath = flags.group as string;
      const index = flags.index as number;
      requireFile(file);
      requireFile(imageFile);
      requireFile(xcfFile);
      requireFile(manifestFile);
      let manifest: {
        formatVersion?: number;
        sourcePath?: string;
        item?: {
          name?: string;
          opacity?: number;
          visible?: boolean;
          x?: number;
          y?: number;
          mask?: { name?: string; visible?: boolean; opacity?: number; showMask?: boolean; applyMask?: boolean; editMask?: boolean };
        };
        render?: { x?: number; y?: number };
      };
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as typeof manifest;
      } catch (error) {
        throw new CliError(400, `Invalid layer bundle manifest: ${(error as Error).message}`);
      }
      if (manifest.formatVersion !== 1 || typeof manifest.item?.name !== 'string') throw new CliError(400, 'Unsupported or incomplete layer bundle manifest');
      if (manifest.item.mask && typeof manifest.sourcePath !== 'string') throw new CliError(400, 'Layer bundle is missing the source path required to restore its mask');
      prepareOutput(output, [file], true);
      const body = await batch(run, `import gi
gi.require_version("Gegl", "0.4")
from gi.repository import Gegl
image = load_image(${quotePython(file)})
ensure_root(image)
parent = find_group(image, ${quotePython(groupPath)})
layer = Gimp.file_load_layer(Gimp.RunMode.NONINTERACTIVE, image, Gio.File.new_for_path(${quotePython(imageFile)}))
if layer is None:
    raise CliFailure(400, "GIMP could not load the layer PNG from the bundle")
layer.set_name(${quotePython(manifest.item.name)})
layer.set_opacity(${Number(manifest.item.opacity ?? 100)})
layer.set_visible(${manifest.item.visible === false ? 'False' : 'True'})
layer.set_offsets(${Number(manifest.render?.x ?? 0)}, ${Number(manifest.render?.y ?? 0)})
mask_settings = json.loads(${quotePython(JSON.stringify(manifest.item.mask ?? null))})
if mask_settings is not None:
    source_image = load_image(${quotePython(xcfFile)})
    source_item = find_item(source_image, ${quotePython(manifest.sourcePath ?? '')})
    source_mask = source_item.get_mask()
    if source_mask is None:
        raise CliFailure(400, "The bundle XCF does not contain its declared layer mask")
    new_mask = layer.create_mask(Gimp.AddMaskType.WHITE)
    if new_mask is None or not layer.add_mask(new_mask):
        raise CliFailure(500, "GIMP could not create the imported layer mask")
    source_buffer = source_mask.get_buffer()
    target_buffer = new_mask.get_buffer()
    source_rect = source_buffer.get_extent()
    offset_x = int(${Number(manifest.item.x ?? 0)})
    offset_y = int(${Number(manifest.item.y ?? 0)})
    target_x = max(0, source_rect.x + offset_x)
    target_y = max(0, source_rect.y + offset_y)
    source_x = source_rect.x + target_x - (source_rect.x + offset_x)
    source_y = source_rect.y + target_y - (source_rect.y + offset_y)
    copy_width = min(source_rect.width - (source_x - source_rect.x), target_buffer.get_extent().width - target_x)
    copy_height = min(source_rect.height - (source_y - source_rect.y), target_buffer.get_extent().height - target_y)
    if copy_width > 0 and copy_height > 0:
        source_buffer.copy(
            Gegl.Rectangle.new(source_x, source_y, copy_width, copy_height),
            Gegl.AbyssPolicy.NONE,
            target_buffer,
            Gegl.Rectangle.new(target_x, target_y, copy_width, copy_height),
        )
    target_buffer.flush()
    new_mask.update(0, 0, new_mask.get_width(), new_mask.get_height())
    new_mask.set_name(mask_settings.get("name", "Mask"))
    new_mask.set_visible(mask_settings.get("visible", True))
    new_mask.set_opacity(mask_settings.get("opacity", 100.0))
    layer.set_show_mask(mask_settings.get("showMask", False))
    layer.set_apply_mask(mask_settings.get("applyMask", True))
    layer.set_edit_mask(mask_settings.get("editMask", False))
if not image.insert_layer(layer, parent, ${index}):
    raise CliFailure(500, "GIMP could not insert the imported layer into " + ${quotePython(groupPath)})
emit(save_result(image, ${quotePython(output)}))`);
      return { body };
    }
  };
}
