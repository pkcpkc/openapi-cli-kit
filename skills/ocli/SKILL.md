---
name: ocli
description: Add ready-made command-line tools (each with its own agent skill) to a project with `ocli add`, and write new CLIs as OpenAPI 3.1 documents with x-cli-* extensions using openapi-cli-kit. Use it when a project needs a CLI for agents (such as ImageMagick image work), when writing or changing a CLI built on openapi-cli-kit, or when checking a `<binary>.openapi.json` with `ocli lint`.
---

# ocli: CLIs described by OpenAPI documents

A CLI built with openapi-cli-kit is described by one OpenAPI 3.1 document, `<binary>.openapi.json`, with `x-cli-*`
extensions. The document is the CLI's contract: subcommands are paths, positional arguments are path parameters,
flags are query parameters, stdin is the request body, and each outcome is a response with an exit code. One runner
reads the document, so the argument parsing, `--help`, `--json` and exit codes come for free. The commands are
listed in [references/commands.md](references/commands.md).

## Add a CLI from the library

```bash
ocli list
ocli add imagemagick
ocli add imagemagick --as img --dir tools --skills-dir .claude/skills
```

`add` writes:

- `<dir>/<binary>/`: the source files, the spec `<binary>.openapi.json`, and a launcher `bin.mjs`.
- `<skills-dir>/<binary>/`: `SKILL.md` and `references/commands.md`.
- `package.json`: the launcher under `bin`, unless you pass `--no-package`.

The copied code imports `openapi-cli-kit`, and the launcher runs TypeScript through `tsx`. Install both, then run
`npm link` to put the binary on the PATH. Do what the result's `next` lists. The project owns the copy, so change it
as needed. Exit 3 means something is already there: pass `--force` to overwrite it, or `--as` to use another name.

## Write a CLI

1. Define it with the DSL in TypeScript. Each `OpDef` has `id`, `cmd` (its words), `method` (`get` only reads),
   `summary`, `args`, `flags` and `result`. Use `job` for commands that queue work and `slow` for long calls.
2. Write the handlers, keyed by `id`. A handler returns `{ body, text? }` or throws
   `new CliError(status, message, hint)`, where status is 400, 404, 409, 500, 503 or 504. The hint always says
   what to do next.
3. Write the spec and the skill's reference with `writeCli(entry)` (`entry` is `{ def, handlers, specFile,
   skillDir }`). The launcher is one call to `runProcess(specFile, handlers())`.
4. Test it with `expect(cliProblems(entry)).toEqual([])`. This checks that the spec is current and lints clean,
   that the handlers and commands match, and that the skill's examples parse.

```bash
ocli lint cli/img/img.openapi.json
ocli reference cli/img/img.openapi.json --json
```

## Rules

- Write `SKILL.md` by hand: what the CLI is for, when not to use it, and recipes. `references/commands.md` is
  generated; don't edit it.
- Every command takes `--json`: the result goes to stdout as one JSON document, and errors go to stderr.
- Flags are `--kebab-case`. A `delete` asks for `--yes`.
