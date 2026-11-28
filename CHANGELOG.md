# Changelog

All notable changes are listed here. The project follows [semantic versioning](https://semver.org).

## 0.2.0

- Add GIMP as a library CLI alongside ImageMagick, with image, layers, PDB and script profiles.
- Add profile-specific OpenAPI contracts and references; move image effects into the image profile.
- Improve library item scaffolding and prerequisite detection.
- Extract shared profile artifact generation and tighten package manifest typing.

## 0.1.0

- The specification (SPEC.md v0.1) and the `x-cli-*` extension schema.
- The runner: argument parsing, help, `--json`, exit codes.
- The DSL (`buildSpec`), with standard outcomes and schemas that each CLI can override.
- The project helpers: `writeCli`, `cliProblems`, `runProcess`.
- The `ocli` command: `list`, `add`, `lint`, `reference`.
- The library's first item, `imagemagick`: ImageMagick 7 as twelve typed commands, with its agent skill.
- The `gimp` library item: common-format image import/export, editable nested layer groups, masks, layer bundles, text, filters and runtime PDB discovery, with its agent skill.
- Focused OpenAPI profiles generated from one CLI definition, with profile-specific references and GIMP Python script execution.
- GIMP handlers split by runtime and command domain, with shared Python helpers as a checked `.py` module.
- MCP servers as library items: `McpClient` (stdio, Streamable HTTP), `mcpCommands`, `mcpHandlers`.
- `npm run new-item` and the Claude Code slash commands `/new-item` and `/mcp-to-item`.
- The command is called `ocli`.
