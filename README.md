# openapi-cli-kit

**Describe a command-line tool as an OpenAPI 3.1 document, and get the runner for free.** The document is the CLI's
contract:

- subcommands are paths;
- positional arguments are path parameters;
- flags are query parameters;
- stdin is the request body;
- each outcome is a response with an exit code.

One runner reads the document, parses the arguments, prints `--help`, writes `--json` and maps failures to exit codes.
You write only the handlers.

It is made for CLIs that **agents** call, where a stable contract matters most. Each CLI comes with an agent skill:
the `SKILL.md` you write, plus a command reference generated from the document. The kit also has a **library** of
ready-made CLIs. `ocli add` copies one into your project, with its skill.

- [SPEC.md](SPEC.md): the specification (the `x-cli-*` extensions and the conventions).
- [schema/openapi-cli-extensions.schema.json](schema/openapi-cli-extensions.schema.json): the extensions' JSON Schema.
- [library/](library/): the ready-made CLIs, including `imagemagick` for ImageMagick 7 and `gimp` for GIMP 3 image workflows, scripts and its local PDB.

## Why

- **One contract.** The parser, the help, the JSON output, the exit codes, the skill and the tests all come from the
  same document, so they cannot drift apart.
- **Predictable for agents.** Every command takes `--json`. Errors are `{error, status, hint}` on stderr, and the hint
  says what to do next. Exit codes are fixed: 1 usage, 2 not found, 3 conflict, 4 unavailable, 5 failed, 124 timed
  out. `get` commands only read, so an agent can run them without asking.
- **Still OpenAPI.** Any OpenAPI 3.1 tooling can read and validate the documents, and a linter checks the CLI rules
  on top.

## Add a CLI from the library

```bash
npm install openapi-cli-kit tsx
npx ocli list
npx ocli add imagemagick            # or: --as img --dir tools --skills-dir .claude/skills
npm link                                   # puts magick-cli on the PATH
magick-cli trim scan.png --fuzz 5 -o tight.png --json
```

`add` writes:

```
cli/magick-cli/
  spec.ts                    the definition (the DSL), yours to change
  handlers.ts                the commands' code
  magick-cli.openapi.json    the contract, built from spec.ts
  bin.mjs                    the launcher (runs the TypeScript through tsx)
.agents/skills/magick-cli/
  SKILL.md                   what it is for, when to use it, recipes
  references/commands.md     every command, generated from the contract
package.json                 "bin": { "magick-cli": "cli/magick-cli/bin.mjs" }
```

The copy is yours, as with code generators: change it freely, and keep it in step with the tests below.

| Item | Binary | What | Needs |
| --- | --- | --- | --- |
| `imagemagick` | `magick-cli` | `info`, `resize`, `crop`, `trim`, `pad`, `convert`, `overlay`, `grid`, `adjust`, `effect`, `transparent`, `compare` on image files | ImageMagick 7 (`magick`, or `MAGICK_BINARY`) |
| `gimp` | `gimp-cli` | Common-format import/export, image edits, nested groups/layers, masks, layer bundles, custom scripts, PDB discovery and focused OpenAPI profiles | GIMP 3 (`gimp`, macOS GIMP.app, or `GIMP_BINARY`) |

### From an MCP server

Any MCP server can become a library item: one command per tool, a typed flag per argument, and `--input` (or JSON
on stdin) for the whole argument object. Run `npm run new-item -- <name> --mcp-command "npx -y some-server"` or
`--mcp-url https://…`, or use the `/mcp-to-item` slash command in Claude Code. Each call connects through the kit's
dependency-free MCP client (`McpClient`: stdio and Streamable HTTP), calls the tool and closes. Secrets stay in the
environment as `${env:NAME}`.

## Write your own CLI

```ts
// cli/tool/spec.ts
import type { CliDef } from 'openapi-cli-kit';

export const cli: CliDef = {
  binary: 'tool',
  version: '1.0.0',
  summary: 'Items, read and run.',
  description: 'Gets items and runs them.',
  examples: ['tool item get a1 --json | jq .name'],
  schemas: {},
  ops: [
    { id: 'get', cmd: 'item get', method: 'get', summary: 'One item', args: [{ name: 'id', description: 'Its id' }], result: { description: 'The item' } },
    { id: 'run', cmd: 'item run', method: 'post', summary: 'Run an item', args: [{ name: 'id', description: 'Its id' }], job: { timeout: '10m' }, result: { description: 'Its result' } },
  ],
};
```

```ts
// cli/tool/handlers.ts
import { CliError, type Handlers } from 'openapi-cli-kit';

export const handlers = (): Handlers => ({
  get: async ({ args }) => {
    const item = await findItem(args.id);
    if (!item) throw new CliError(404, `No item ${args.id}`, 'tool item ls lists them');
    return { body: item, text: `${item.name}\n` };
  },
  run: async ({ args, flags }) => ({ body: await runItem(args.id, flags.timeout) }),
});
```

```ts
// cli/build.ts: writes tool.openapi.json and the skill's references/commands.md
import { writeCli, type CliEntry } from 'openapi-cli-kit';
import { cli } from './tool/spec.ts';
import { handlers } from './tool/handlers.ts';

export const tool: CliEntry = { def: cli, handlers, specFile: 'cli/tool/tool.openapi.json', skillDir: '.agents/skills/tool' };
writeCli(tool);
```

```js
#!/usr/bin/env node
// cli/tool/bin.mjs
import { register } from 'tsx/esm/api';
register();
const { runProcess } = await import('openapi-cli-kit');
const { handlers } = await import('./handlers.ts');
await runProcess(new URL('./tool.openapi.json', import.meta.url), handlers());
```

```ts
// tests/tool.test.ts: the spec is current and lints clean, every command has a handler, the skill's examples parse
import { cliProblems } from 'openapi-cli-kit';
import { tool } from '../cli/build.ts';

it('is in step', () => expect(cliProblems(tool)).toEqual([]));
```

The DSL fills in the conventions of SPEC.md:

- the paths, from the words and arguments;
- `--json` on every command;
- the standard outcomes and their exit codes;
- `--no-wait` and `--timeout` on commands that queue work (`job`) or wait long (`slow`).

A CLI can word the standard outcomes its own way (`responses`), and replace the shared `Task` or `Error` schema
(`schemas`).

For a CLI with many commands, `profiles` can define focused OpenAPI views by operation ID. Each profile has a
`summary`, `description`, `examples`, and `operationIds`. The full spec stays the runtime contract; `writeCli` and
`ocli add` also write smaller profile specs and references, so an agent can load only the image, layer, or scripting
commands relevant to its task.

### The API

| Export | What |
| --- | --- |
| `buildSpec(def, profile?)`, `specText(def, profile?)` | The full OpenAPI document or a focused profile, as an object or as written |
| `runCli(spec, handlers, argv, io)` | Runs a command, with injectable I/O (for tests); returns the exit code |
| `runProcess(specFile, handlers)` | Runs the process's arguments (for a launcher) |
| `writeCli(entry)`, `cliProblems(entry)` | Writes a CLI's full and focused specs and skill references; lists what is out of step |
| `lintSpec(spec)` | The document's problems, by SPEC.md and the extension schema |
| `referenceText(spec)` | The commands as markdown |
| `CliError(status, message, hint)` | A failure, by the status that maps to its exit code |
| `McpClient`, `mcpCommands(tools)`, `mcpHandlers(server, commands)` | MCP servers as CLIs |
| `parseArgs`, `findCommand`, `commands`, `overviewHelp`, `commandHelp` | The runner's parts |

### The `ocli` command

| Command | What |
| --- | --- |
| `ocli list` | The library's CLIs |
| `ocli add <item> [--as name] [--dir cli] [--skills-dir .agents/skills] [--force] [--no-package]` | Copies one into the project |
| `ocli lint <spec>` | Checks a `<binary>.openapi.json` |
| `ocli reference <spec>` | Prints its commands as markdown |

It is itself a CLI of this kind: [specs/ocli.openapi.json](specs/ocli.openapi.json), with an agent
skill in [skills/ocli/](skills/ocli/).

## Requirements

- Node.js 20.19 or later.
- Library items and launchers are TypeScript run through [tsx](https://tsx.is): install it alongside.

## Contributing

New library items are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to add one.

## License

[MIT](LICENSE). This covers the code, the specification and the schema.
