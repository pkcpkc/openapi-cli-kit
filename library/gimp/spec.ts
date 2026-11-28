import type { CliDef, FlagDef, OpDef } from 'openapi-cli-kit';

/**
 * `gimp-cli`: inspect GIMP's live PDB and process common image formats with editable, layer-aware workflows.
 */

const imageArg = (name = 'image', description = 'An image supported by this GIMP installation') => ({
  name,
  description,
  schema: { type: 'string', format: 'path' },
});

const out: FlagDef = {
  name: '--out',
  short: '-o',
  description: 'Where GIMP writes the result; the extension selects an installed format exporter',
  required: true,
  schema: { type: 'string', format: 'path' },
};

const write = (op: Omit<OpDef, 'method' | 'conflicts'>): OpDef => ({
  method: 'post',
  conflicts: false,
  ...op,
  flags: [...(op.flags ?? []), out],
});

const point = { type: 'string', pattern: '^-?\\d+,-?\\d+$' };
const size = { type: 'string', pattern: '^\\d+x\\d+$' };
const rect = { type: 'string', pattern: '^\\d+,\\d+,\\d+,\\d+$' };
const imageResult = {
  type: 'object',
  required: ['file', 'width', 'height', 'format'],
  properties: {
    file: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    format: { type: 'string', description: 'Format chosen by the output extension' },
    layers: { type: 'integer' },
  },
};

export const cli: CliDef = {
  binary: 'gimp-cli',
  version: '1.0.0',
  minVersion: '3.0',
  summary: 'Explore GIMP’s PDB and process images with common formats, editable layers, masks, text and filters.',
  description: `Uses the installed GIMP 3 batch interpreter and its enabled format plug-ins. It imports supported files,
exports through GIMP’s available exporters, and preserves layer-aware work in XCF outputs. This requires GIMP 3 on PATH,
a standard macOS GIMP.app bundle, or GIMP_BINARY set to its executable. Each command starts GIMP in batch mode.`,
  examples: [
    'gimp-cli image info photo.webp --json',
    'gimp-cli image export photo.xcf --out photo.jpg --json',
    'gimp-cli image assemble --layer sky.jpg --layer subject.png --out composite.xcf',
    'gimp-cli layers group-add composite.xcf --parent Root --name Labels --out grouped.xcf',
    'gimp-cli layers move composite.xcf Root/subject.png --to Root/Labels --index 0 --out reordered.xcf',
    'gimp-cli layers export composite.xcf Root/Labels --dir label-bundle',
    'gimp-cli layers import composite.xcf --bundle label-bundle --group Root --out restored.xcf',
    'gimp-cli layers list composite.xcf --json | jq .layers',
    'gimp-cli layers mask-add composite.xcf Subject --type white --out masked.xcf',
    'gimp-cli image text add composite.xcf --text "Hello" --font auto --size 48 --color "#ffffff" --at 24,24 --out titled.xcf',
    'gimp-cli image effect photo.xcf --preset blur --amount 8 --out soft.xcf',
    "gimp-cli pdb list --match 'file.*' --limit 20 --json | jq -r '.procedures[]'",
  ],
  profiles: {
    image: {
      summary: 'Import, export and transform image documents with GIMP.',
      description: 'Focused contract for image-level workflows: inspect, convert, assemble, resize, crop, add text or watermarks, and apply effects.',
      examples: [
        'gimp-cli image assemble --layer sky.jpg --layer subject.png --out composite.xcf',
        'gimp-cli image export composite.xcf --out composite.webp --json',
      ],
      operationIds: [
        'image-info', 'image-import', 'image-export', 'image-assemble', 'image-resize',
        'image-crop', 'image-transform', 'image-flatten', 'image-watermark', 'image-text-add', 'image-effect',
      ],
    },
    layers: {
      summary: 'Inspect and edit GIMP layer trees, groups and masks.',
      description: 'Focused contract for path-addressed layer and group operations, including visibility, ordering, masks and bundles.',
      examples: [
        'gimp-cli layers list composite.xcf --json | jq \'.layers\'',
        'gimp-cli layers mask-add composite.xcf Root/Labels --type white --out masked.xcf',
      ],
      operationIds: [
        'layers-list', 'layers-add', 'layers-set', 'layers-mask-add', 'layers-group-add',
        'layers-move', 'layers-group', 'layers-merge', 'layers-show', 'layers-hide', 'layers-delete',
        'layers-export', 'layers-import', 'paths-export',
      ],
    },
    pdb: {
      summary: 'Discover GIMP procedures and inspect their local metadata.',
      description: 'Focused contract for querying, inspecting and exporting the Procedure Database available in the installed GIMP.',
      examples: [
        "gimp-cli pdb list --match 'file.*' --limit 20 --json | jq -r '.procedures[]'",
        'gimp-cli pdb info file-png-export --json',
      ],
      operationIds: ['pdb-list', 'pdb-info', 'pdb-dump'],
    },
    script: {
      summary: 'Run a trusted GIMP Python batch script.',
      description: 'Focused contract for custom GIMP automation beyond the typed image and layer operations. Scripts execute locally inside GIMP with the current user’s permissions.',
      examples: ['gimp-cli script run ./my-gimp-task.py --json'],
      operationIds: ['script-run'],
    },
  },
  schemas: {
    ProcedureParameter: {
      type: 'object',
      required: ['name', 'type'],
      properties: { name: { type: 'string' }, nick: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' } },
    },
    Procedure: {
      type: 'object',
      required: ['name', 'blurb', 'help', 'helpId', 'arguments', 'returns'],
      properties: {
        name: { type: 'string' },
        blurb: { type: 'string' },
        help: { type: 'string' },
        helpId: { type: 'string' },
        arguments: { type: 'array', items: { $ref: 'ProcedureParameter' } },
        returns: { type: 'array', items: { $ref: 'ProcedureParameter' } },
      },
    },
    ProcedureList: {
      type: 'object',
      required: ['total', 'offset', 'limit', 'procedures'],
      properties: {
        total: { type: 'integer' },
        offset: { type: 'integer' },
        limit: { type: 'integer' },
        procedures: { type: 'array', items: { type: 'string' } },
      },
    },
    Dump: { type: 'object', required: ['file'], properties: { file: { type: 'string' } } },
    Image: {
      ...imageResult,
      properties: {
        ...imageResult.properties,
        layers: { type: 'integer', description: 'Total number of layer and group items in the project' },
      },
    },
    LayerTree: {
      type: 'object',
      required: ['file', 'width', 'height', 'layers'],
      properties: {
        file: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        baseType: { type: 'string' },
        layers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              path: { type: 'string', description: 'Slash-separated path; literal / and ~ are escaped as ~1 and ~0' },
              visible: { type: 'boolean' },
              opacity: { type: 'number' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              x: { type: 'integer' },
              y: { type: 'integer' },
              group: { type: 'boolean' },
              mask: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  visible: { type: 'boolean' },
                  opacity: { type: 'number' },
                  showMask: { type: 'boolean' },
                  applyMask: { type: 'boolean' },
                  editMask: { type: 'boolean' },
                },
              },
              children: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    },
    ExportedLayers: {
      type: 'object',
      required: ['directory', 'files'],
      properties: { directory: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } },
    },
    LayerBundle: {
      type: 'object',
      required: ['directory', 'image', 'manifest', 'masks'],
      properties: {
        directory: { type: 'string' },
        image: { type: 'string', description: 'Rendered PNG for the selected layer or group' },
        manifest: { type: 'string', description: 'JSON layer and mask settings' },
        masks: { type: 'array', items: { type: 'string' } },
      },
    },
    ScriptResult: {
      type: 'object',
      required: ['script', 'stdout'],
      properties: {
        script: { type: 'string' },
        stdout: { type: 'string', description: 'Text printed by the script' },
        result: { description: 'Optional JSON-serializable value assigned to the Python variable result' },
      },
    },
  },
  ops: [
    {
      id: 'image-info',
      cmd: 'image info',
      method: 'get',
      summary: 'Inspect image dimensions, base type and layer tree',
      args: [imageArg()],
      result: { description: 'Image metadata and its layers', schema: 'LayerTree' },
    },
    write({
      id: 'image-import',
      cmd: 'image import',
      summary: 'Import any supported image as an editable XCF project under a Root group',
      args: [imageArg()],
      result: { description: 'The XCF project written', schema: 'Image' },
    }),
    write({
      id: 'image-export',
      cmd: 'image export',
      summary: 'Export or convert an image using the installed GIMP format plug-ins',
      args: [imageArg()],
      result: { description: 'The exported image', schema: 'Image' },
    }),
    write({
      id: 'image-assemble',
      cmd: 'image assemble',
      summary: 'Load multiple images as layers under a Root group; first is the canvas, later files stack above it',
      flags: [
        { name: '--layer', short: '-l', description: 'Input image in bottom-to-top order; repeat for each image', required: true, schema: { type: 'array', items: { type: 'string', format: 'path' } } },
      ],
      result: { description: 'The layered XCF project', schema: 'Image' },
    }),
    write({
      id: 'image-resize',
      cmd: 'image resize',
      summary: 'Scale the image and its layers to an exact canvas size',
      args: [imageArg()],
      flags: [{ name: '--size', short: '-s', description: 'New width and height in pixels', required: true, schema: size }],
      result: { description: 'The resized image', schema: 'Image' },
    }),
    write({
      id: 'image-crop',
      cmd: 'image crop',
      summary: 'Crop to a rectangle in image coordinates',
      args: [imageArg()],
      flags: [{ name: '--rect', description: 'x,y,width,height in pixels, from the top-left', required: true, schema: rect }],
      result: { description: 'The cropped image', schema: 'Image' },
    }),
    write({
      id: 'image-transform',
      cmd: 'image transform',
      summary: 'Rotate the image by a right angle or flip it',
      args: [imageArg()],
      flags: [
        { name: '--rotate', description: 'Clockwise rotation in degrees', schema: { type: 'integer', enum: [90, 180, 270] } },
        { name: '--flip', description: 'Flip around the horizontal or vertical axis', schema: { enum: ['horizontal', 'vertical'] } },
      ],
      result: { description: 'The transformed image', schema: 'Image' },
    }),
    write({
      id: 'image-flatten',
      cmd: 'image flatten',
      summary: 'Merge visible layers into one background layer',
      args: [imageArg()],
      result: { description: 'The flattened image', schema: 'Image' },
    }),
    write({
      id: 'image-watermark',
      cmd: 'image watermark',
      summary: 'Add a logo or watermark as an editable layer',
      args: [imageArg()],
      flags: [
        { name: '--logo', description: 'Image file to add as the watermark layer', required: true, schema: { type: 'string', format: 'path' } },
        { name: '--at', description: 'Top-left offset in pixels', schema: { ...point, default: '0,0' } },
        { name: '--opacity', description: 'Watermark opacity in percent', schema: { type: 'number', minimum: 0, maximum: 100, default: 30 } },
      ],
      result: { description: 'The XCF project with a watermark layer', schema: 'Image' },
    }),
    write({
      id: 'image-text-add',
      cmd: 'image text add',
      summary: 'Add an editable text layer using an installed font',
      args: [imageArg()],
      flags: [
        { name: '--text', description: 'Text to render into the editable layer', required: true, schema: { type: 'string' } },
        { name: '--font', description: 'Installed font name, or auto to use the first currently loaded font', schema: { type: 'string', default: 'auto' } },
        { name: '--size', description: 'Font size in pixels', schema: { type: 'number', minimum: 1, maximum: 1000, default: 48 } },
        { name: '--color', description: 'Text color, such as #ffffff', schema: { type: 'string', default: '#ffffff' } },
        { name: '--at', description: 'Top-left offset in pixels', schema: { ...point, default: '0,0' } },
      ],
      result: { description: 'The XCF project with an editable text layer', schema: 'Image' },
    }),
    write({
      id: 'image-effect',
      cmd: 'image effect',
      summary: 'Add a non-destructive blur, grayscale or sharpen GEGL filter to a layer or group',
      args: [imageArg()],
      flags: [
        { name: '--preset', description: 'Effect to add non-destructively', required: true, schema: { enum: ['blur', 'grayscale', 'sharpen'] } },
        { name: '--amount', description: 'Blur radius or sharpening strength; not used by grayscale', schema: { type: 'number', minimum: 0.1, maximum: 100 } },
        { name: '--layer', description: 'Target layer/group path from `layers list` (default: first visible child of Root)', schema: { type: 'string' } },
      ],
      result: { description: 'The XCF project with a non-destructive filter', schema: 'Image' },
    }),
    {
      id: 'layers-list',
      cmd: 'layers list',
      method: 'get',
      summary: 'List the nested layer/group tree, with paths, visibility, opacity, offsets and masks',
      args: [imageArg()],
      result: { description: 'The image layer tree', schema: 'LayerTree' },
    },
    write({
      id: 'layers-add',
      cmd: 'layers add',
      summary: 'Import multiple supported images into a group in an XCF project',
      args: [imageArg()],
      flags: [
        { name: '--layer', short: '-l', description: 'Image to import as a layer, in bottom-to-top order; repeat as needed', required: true, schema: { type: 'array', items: { type: 'string', format: 'path' } } },
        { name: '--group', description: 'Target group path from `layers list` (default: Root)', schema: { type: 'string', default: 'Root' } },
      ],
      result: { description: 'The XCF project with imported layers', schema: 'Image' },
    }),
    write({
      id: 'layers-set',
      cmd: 'layers set',
      summary: 'Change a layer name, visibility or opacity',
      args: [imageArg(), { name: 'layer', description: 'Layer/group path from `layers list`' }],
      flags: [
        { name: '--name', description: 'New layer name', schema: { type: 'string' } },
        { name: '--visible', description: 'Set layer visibility', schema: { type: 'boolean' } },
        { name: '--opacity', description: 'Set opacity in percent', schema: { type: 'number', minimum: 0, maximum: 100 } },
      ],
      result: { description: 'The updated XCF project', schema: 'Image' },
    }),
    write({
      id: 'layers-mask-add',
      cmd: 'layers mask-add',
      summary: 'Add an editable mask to a layer or group',
      args: [imageArg(), { name: 'layer', description: 'Layer path from `layers list`' }],
      flags: [
        { name: '--type', description: 'How to initialize the mask', required: true, schema: { enum: ['white', 'black', 'alpha', 'alpha-transfer', 'copy'] } },
      ],
      result: { description: 'The XCF project with a layer mask', schema: 'Image' },
    }),
    write({
      id: 'layers-group-add',
      cmd: 'layers group-add',
      summary: 'Create a folder group inside another group',
      args: [imageArg()],
      flags: [
        { name: '--name', description: 'New folder name (must not contain /)', required: true, schema: { type: 'string' } },
        { name: '--parent', description: 'Parent group path from `layers list`', schema: { type: 'string', default: 'Root' } },
        { name: '--index', description: 'Position in the parent, top-to-bottom starting at 0', schema: { type: 'integer', minimum: 0, default: 0 } },
      ],
      result: { description: 'The XCF project with a new group', schema: 'Image' },
    }),
    write({
      id: 'layers-move',
      cmd: 'layers move',
      summary: 'Move or reorder a layer/group into a group at a top-to-bottom index',
      args: [imageArg(), { name: 'layer', description: 'Layer/group path from `layers list`' }],
      flags: [
        { name: '--to', description: 'Destination group path from `layers list`', required: true, schema: { type: 'string' } },
        { name: '--index', description: 'Destination position, top-to-bottom starting at 0', required: true, schema: { type: 'integer', minimum: 0 } },
      ],
      result: { description: 'The reordered XCF project', schema: 'Image' },
    }),
    write({
      id: 'layers-group',
      cmd: 'layers group',
      summary: 'Put multiple sibling layers/groups into one named folder group',
      args: [imageArg()],
      flags: [
        { name: '--layer', short: '-l', description: 'Layer/group path to include; repeat for each sibling', required: true, schema: { type: 'array', minItems: 2, items: { type: 'string' } } },
        { name: '--name', description: 'Name of the new folder group', required: true, schema: { type: 'string' } },
      ],
      result: { description: 'The XCF project with the new group', schema: 'Image' },
    }),
    write({
      id: 'layers-merge',
      cmd: 'layers merge',
      summary: 'Merge selected sibling layers into one raster layer, or merge a group into one layer',
      args: [imageArg()],
      flags: [
        { name: '--layer', short: '-l', description: 'Layer/group path to merge; repeat for sibling layers', required: true, schema: { type: 'array', minItems: 1, items: { type: 'string' } } },
        { name: '--name', description: 'Name for the merged result', schema: { type: 'string', default: 'Merged' } },
      ],
      result: { description: 'The XCF project with one merged layer', schema: 'Image' },
    }),
    write({
      id: 'layers-show',
      cmd: 'layers show',
      summary: 'Show a layer or group',
      args: [imageArg(), { name: 'layer', description: 'Layer/group path from `layers list`' }],
      result: { description: 'The XCF project with the item visible', schema: 'Image' },
    }),
    write({
      id: 'layers-hide',
      cmd: 'layers hide',
      summary: 'Hide a layer or group',
      args: [imageArg(), { name: 'layer', description: 'Layer/group path from `layers list`' }],
      result: { description: 'The XCF project with the item hidden', schema: 'Image' },
    }),
    write({
      id: 'layers-delete',
      cmd: 'layers delete',
      summary: 'Delete a layer or a whole group and its contents',
      args: [imageArg(), { name: 'layer', description: 'Layer/group path from `layers list`' }],
      result: { description: 'The XCF project after deletion', schema: 'Image' },
    }),
    {
      id: 'layers-export',
      cmd: 'layers export',
      method: 'post',
      conflicts: false,
      summary: 'Export one layer or group as a rendered image bundle with XCF, settings and mask images',
      args: [imageArg(), { name: 'layer', description: 'Layer/group path from `layers list`' }],
      flags: [
        { name: '--dir', description: 'Directory for the layer bundle', required: true, schema: { type: 'string', format: 'path' } },
      ],
      result: { description: 'Rendered PNG, editable XCF, JSON settings and mask images', schema: 'LayerBundle' },
    },
    write({
      id: 'layers-import',
      cmd: 'layers import',
      summary: 'Re-import a layer bundle into a group',
      args: [imageArg()],
      flags: [
        { name: '--bundle', description: 'Directory created by `layers export`', required: true, schema: { type: 'string', format: 'path' } },
        { name: '--group', description: 'Destination group path (default: Root)', schema: { type: 'string', default: 'Root' } },
        { name: '--index', description: 'Position in the destination group, top-to-bottom starting at 0', schema: { type: 'integer', minimum: 0, default: 0 } },
      ],
      result: { description: 'The XCF project with the re-imported layer', schema: 'Image' },
    }),
    {
      id: 'paths-export',
      cmd: 'paths export',
      method: 'post',
      conflicts: false,
      summary: 'Export GIMP paths as editable SVG files',
      args: [imageArg()],
      flags: [{ name: '--dir', description: 'Directory for SVG files', required: true, schema: { type: 'string', format: 'path' } }],
      result: { description: 'SVG files exported from the image paths', schema: 'ExportedLayers' },
    },
    {
      id: 'pdb-list',
      cmd: 'pdb list',
      method: 'get',
      summary: 'List installed procedure names, optionally filtered by a regular expression',
      flags: [
        { name: '--match', description: 'A regular expression matched against procedure names', schema: { type: 'string', default: '.*' } },
        { name: '--limit', description: 'Maximum number of names to return', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
        { name: '--offset', description: 'Number of matching names to skip', schema: { type: 'integer', minimum: 0, default: 0 } },
      ],
      result: { description: 'The matching procedure names and page information', schema: 'ProcedureList' },
    },
    {
      id: 'pdb-info',
      cmd: 'pdb info',
      method: 'get',
      summary: 'Inspect a procedure’s documentation and argument/return types',
      args: [{ name: 'procedure', description: 'The exact procedure name, from `pdb list`' }],
      result: { description: 'The installed procedure’s metadata', schema: 'Procedure' },
    },
    {
      id: 'pdb-dump',
      cmd: 'pdb dump',
      method: 'post',
      conflicts: false,
      summary: 'Write GIMP’s complete local procedure database documentation to a file',
      flags: [{
        name: '--out',
        short: '-o',
        description: 'Where GIMP writes the local PDB documentation dump',
        required: true,
        schema: { type: 'string', format: 'path' },
      }],
      result: { description: 'The local PDB documentation dump', schema: 'Dump' },
    },
    {
      id: 'script-run',
      cmd: 'script run',
      method: 'post',
      summary: 'Run a trusted Python script inside GIMP’s batch interpreter',
      description: 'The script can import GIMP APIs, load and save files, and use any procedures available in this installation. Its optional Python variable `result` must be JSON serializable.',
      args: [{ name: 'script', description: 'Path to a trusted Python script to execute inside GIMP', schema: { type: 'string', format: 'path' } }],
      result: { description: 'The script path, captured printed output, and optional result value', schema: 'ScriptResult' },
    },
  ],
};
