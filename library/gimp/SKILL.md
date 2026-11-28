---
name: gimp-cli
description: Import, export and edit images with GIMP 3, including nested groups, layers, masks, text and filters; inspect the local GIMP PDB.
---

# gimp-cli: GIMP image workflows and PDB discovery

`gimp-cli` runs GIMP 3's non-interactive Python batch interpreter. Use it when an image needs editable layers,
groups, masks, text or GIMP filters, or when an installed GIMP plug-in provides a format or procedure that a
pixel-only tool does not. Input and output formats depend on the GIMP version and plug-ins installed locally.
For agent tasks, load only the relevant focused schema from [the profile index](references/profiles.md). The full
command reference in [commands.md](references/commands.md) is optional when that broader view is useful.

## Choose an OpenAPI profile

When exposing GIMP to an agent through an OpenAPI tool integration, load the schema for the task rather than the full
`gimp-cli.openapi.json` contract:

| Profile | Use for | Schema |
| --- | --- | --- |
| `image` | Image info, imports/exports, assembly, resizing, cropping, transforms, text, watermarks and effects | [image.openapi.json](references/profiles/image.openapi.json) |
| `layers` | Layer/group trees, masks, visibility, ordering, merging and bundles | [layers.openapi.json](references/profiles/layers.openapi.json) |
| `pdb` | Discovering and inspecting procedures installed in this GIMP | [pdb.openapi.json](references/profiles/pdb.openapi.json) |
| `script` | Running a custom trusted Python batch script | [script.openapi.json](references/profiles/script.openapi.json) |

These are focused views of the same `gimp-cli`, not separate executables. The integration must load the selected
schema; the regular CLI launcher continues to use the full contract. A profile narrows the operations advertised to
the agent, but it is not a security boundary.

## Layer tree and order

- New imports and assemblies have a top-level group named `Root`. `image assemble --layer` takes files bottom-to-top:
  the first image sets the canvas, and later inputs stack above it inside `Root`.
- `layers list` reports the native tree, top-to-bottom, with paths, visibility, opacity, offsets and mask settings.
  Use the returned `path` for commands. Slash and tilde inside names are escaped as `~1` and `~0`.
- `layers group-add` creates a folder; `layers group` moves selected siblings into one folder.
  `layers move --index N` sets order within a group, where index 0 is topmost.
- `layers merge` rasterizes selected sibling layers into one layer, or merges one group. This is destructive to
  their independent layer, mask and filter structure in the output project.
- `layers show`, `layers hide` and `layers set --visible` work on a layer or a group. Hiding a group hides all
  its children without changing their individual visibility.
- `layers delete` removes the addressed layer or the entire group and its contents.
- `layers mask-add` supports the five common initial masks: `white`, `black`, `alpha`, `alpha-transfer`, and
  `copy`. GIMP may reject a mask type when the target or image state does not support it.
- `image effect --layer PATH` adds a non-destructive blur, grayscale or sharpen GEGL filter to a layer or group.

## Formats and layer bundles

GIMP loads formats through its installed file plug-ins. `image import` saves a supported input as XCF; `image export`
selects an installed exporter from the output extension. Use XCF for editable projects.

`layers export IMAGE PATH --dir BUNDLE` exports a selected layer or group as:

- `layer.png`: its rendered image;
- `layer.xcf`: an isolated editable GIMP copy;
- `manifest.json`: path, layer/group settings, and mask settings;
- `masks/mask-*.png`: mask previews for the selected item and nested children.

`layers import IMAGE --bundle BUNDLE` adds the rendered PNG as one layer and restores its name, visibility, opacity,
offsets and direct layer/group mask from the bundle's XCF and manifest. A group is imported as one raster layer;
nested child masks remain available in the bundle's XCF and mask PNGs but are not recreated as separate child layers.

## Custom scripts

Use `gimp-cli script run ./task.py --json` when a task needs GIMP Python or a PDB procedure not covered by a typed
command. The script runs locally inside GIMP with the current user's permissions; only run scripts you trust. It can
import GIMP APIs, load and save files, and use installed procedures. `print()` output is returned as `stdout`; an
optional Python variable named `result` is returned if it is JSON serializable. This is a general escape hatch, not a
sandbox.

## Commands and recipes

```bash
# Create an XCF project from mixed supported formats (input order is bottom-to-top)
gimp-cli image assemble --layer background.jpg --layer subject.png --layer details.webp --out project.xcf

# Inspect paths and masks
gimp-cli layers list project.xcf --json | jq '.layers'

# Add a folder, group existing siblings, and place a layer inside a folder
gimp-cli layers group-add project.xcf --parent Root --name Typography --out folders.xcf
gimp-cli layers group folders.xcf --layer Root/Title --layer Root/Subtitle --name Text --out grouped.xcf
gimp-cli layers move grouped.xcf Root/Logo --to Root/Typography --index 0 --out arranged.xcf

# Hide/show a layer or a whole group; index 0 is the top of a group
gimp-cli layers hide arranged.xcf Root/Typography --out hidden.xcf
gimp-cli layers show hidden.xcf Root/Typography --out visible.xcf
gimp-cli layers move visible.xcf Root/Logo --to Root/Typography --index 1 --out reordered.xcf

# Add a mask or a non-destructive filter to a layer group
gimp-cli layers mask-add reordered.xcf Root/Typography --type white --out masked.xcf
gimp-cli image effect masked.xcf --preset blur --amount 3 --layer Root/Typography --out filtered.xcf

# Export a group as one rendered image plus editable/settings bundle, then import the rendered layer
gimp-cli layers export filtered.xcf Root/Typography --dir typography-bundle
gimp-cli layers import filtered.xcf --bundle typography-bundle --group Root --out with-typography.xcf

# Merge or remove items; merge is destructive in the output
gimp-cli layers merge with-typography.xcf --layer Root/Background --layer Root/Foreground --out merged.xcf
gimp-cli layers delete merged.xcf Root/Old-Group --out cleaned.xcf

# Convert to a format supported by the local GIMP installation
gimp-cli image export cleaned.xcf --out preview.webp

# Run a trusted custom Python batch script
gimp-cli script run ./custom-edit.py --json

# Inspect local procedures when a plug-in or GIMP version changes
gimp-cli pdb list --match 'file.*' --limit 20 --json | jq -r '.procedures[]'
gimp-cli pdb info file-png-export --json | jq '{name, arguments, returns}'
```

`pdb list` searches installed procedure names, `pdb info` inspects one exact procedure, and `pdb dump` writes the
installation's complete local PDB documentation. Check the local PDB rather than assuming an online procedure is
available.

## Documentation and setup

- [GIMP 3 libgimp API reference](https://developer.gimp.org/api/3.0/libgimp/)
- [Python plug-in tutorial](https://developer.gimp.org/resource/writing-a-plug-in/tutorial-python/)
- [PDB tutorial](https://developer.gimp.org/resource/writing-a-plug-in/tutorial-pdb/)
- [Script-Fu v3 porting guide](https://developer.gimp.org/resource/script-fu/porting_scriptfu_scripts/)

Install GIMP 3 from [gimp.org/downloads](https://www.gimp.org/downloads/). The CLI uses `gimp` on `PATH`; on macOS
it also finds the executable in a standard GIMP.app bundle. Set `GIMP_BINARY` to override discovery. `ocli add gimp`
recognizes the macOS app bundle as an installed prerequisite.

Each command starts GIMP in batch mode and can take longer than a text-only CLI. Typed commands do not automate the
graphical interface; custom scripts execute directly inside GIMP.
