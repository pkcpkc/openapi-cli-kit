# Contributing

Thank you for helping. Bug reports, fixes, new library items and improvements to the specification are all welcome.

## Setup

```bash
npm install          # also builds dist/ (prepare)
npm run check        # typecheck, build, test: run it before every pull request
npm run specs        # after changing src/tool/spec.ts: writes specs/ and skills/ocli/references/
```

Tests use [Vitest](https://vitest.dev). Tests that need an external tool, such as ImageMagick, are skipped where the
tool is not installed. Mock it in the other tests: each item's handlers take an injectable runner.

## Adding a library item

In Claude Code, two slash commands walk through it:

- `/new-item <name> <what it wraps>` wraps a command-line tool.
- `/mcp-to-item <name> <stdio command | URL>` turns an MCP server into a CLI, one command per tool.

Both start from `npm run new-item -- <name> [--mcp-command "…" | --mcp-url …]`, which scaffolds the files below and
registers the item. You can also run it by hand.


An item is a folder `library/<name>/`:

| File | What |
| --- | --- |
| `spec.ts` | `export const cli: CliDef`: the definition, binary `<name>-cli` (or another distinctive name) |
| `handlers.ts` | `export const handlers = (): Handlers`, keyed by operation id; side effects behind an injectable runner |
| `SKILL.md` | The agent skill: frontmatter `name: <binary>` and a description of what it does and when to use it, then the rules and recipes in `bash` blocks |
| `item.ts` | The manifest: `name`, `binary`, `summary`, `def`, `files` (the sources to copy) and `requires` (tools on the machine) |

Register it in [library/index.ts](library/index.ts) and add `tests/<name>.test.ts`. `tests/library.test.ts` then
checks, for every item:

- that it lints clean;
- that it installs (renamed too);
- that every command has a handler;
- that its skill's examples parse.

Rules for items:

- Import only from `openapi-cli-kit` and Node built-ins. An item is copied into other projects as it is.
- Run external programs with `execFile` and argument arrays, never through a shell. Resolve paths as given.
- Use only the binary's own name for it. `add --as` renames every whole-word mention of it, in the code and the
  skill.
- Map failures to the standard statuses: 400 for bad input, 404 for a missing file, 503 for a tool that isn't
  installed (with a hint on how to install it), and 500 when the tool itself failed.

## Changing the specification

Change [SPEC.md](SPEC.md), the [schema](schema/openapi-cli-extensions.schema.json) and the linter
(`src/runner/lint.ts`) together, and note the change in [CHANGELOG.md](CHANGELOG.md).

## Pull requests

- Keep each one to one change, with its tests.
- `npm run check` must pass.
- By contributing, you agree that your contribution is licensed under the MIT License.
