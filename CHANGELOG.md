# Changelog

All notable changes are listed here. The project follows [semantic versioning](https://semver.org).

## 0.1.0

- The specification (SPEC.md v0.1) and the `x-cli-*` extension schema.
- The runner: argument parsing, help, `--json`, exit codes.
- The DSL (`buildSpec`), with standard outcomes and schemas that each CLI can override.
- The project helpers: `writeCli`, `cliProblems`, `runProcess`.
- The `ocli` command: `list`, `add`, `lint`, `reference`.
- The library's first item, `magick`: ImageMagick 7 as twelve typed commands, with its agent skill.
- MCP servers as library items: `McpClient` (stdio, Streamable HTTP), `mcpCommands`, `mcpHandlers`.
- `npm run new-item` and the Claude Code slash commands `/new-item` and `/mcp-to-item`.
- The command is called `ocli`.
