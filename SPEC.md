# OpenAPI CLI specification (x-cli-*), v0.1

This document specifies how an **OpenAPI 3.1** document describes a command-line program. The document stays valid
OpenAPI. Seven vendor extensions (`x-cli-*`) add what OpenAPI has no words for: the binary, positional arguments,
short flags, exit codes and output streams. Their JSON Schema is
[schema/openapi-cli-extensions.schema.json](schema/openapi-cli-extensions.schema.json).

The document is the CLI's contract. A conforming runner reads it, parses the arguments, prints the help and maps each
outcome to an exit code, so each command is written only once, as a handler. Agents and people can read the same
document, or a skill made from it, to learn what the CLI does.

The key words MUST, SHOULD and MAY are to be read as in RFC 2119.

## 1. The document

- A CLI has exactly one document, named `<binary>.openapi.json`, with `openapi: "3.1.0"`.
- `info.title` and `info.version` are required. `info.summary` is the one-line description; `info.description` is the
  overview printed by `--help`.
- The root carries `x-cli` (an object). In it, `binary` (required) is the executable's name on the PATH, and
  `min_version` (optional) is the lowest version of the API the CLI talks to.
- `x-cli.examples` (optional) are copy-pasteable shell lines. Each MUST call the binary with one of its commands. A
  linter checks this, and `--help` shows them.

## 2. Commands

| OpenAPI | CLI |
| --- | --- |
| `paths`: literal segments | The subcommand's words: `/item/get/{id}` is `tool item get <id>` |
| `paths`: templated segments | Positional arguments, all after the words |
| `get` | Only reads: safe to run without asking |
| `post` / `put` / `patch` / `delete` | Creates, replaces, changes or deletes. A `delete` SHOULD ask for `--yes` |
| `operationId` | The handler that runs the command; unique in the document |

- A path's literal segments MUST come before its templated ones. Two operations MUST NOT have the same words.
- A command is matched by the longest run of words that starts the argument list. A run of words that only some
  commands share (`tool item`) is a group: called bare, it prints that group's commands.

## 3. Arguments and flags

- **Positional arguments** are parameters with `in: path`. Each is `required: true`, because OpenAPI requires that of a
  path parameter, and carries `x-cli-position`: 0…n, in the order of the path.
- **Flags** are parameters with `in: query`, named exactly as typed: `--kebab-case`. `x-cli-short` gives a
  single-letter alias such as `-n`. Flags may appear anywhere after the words; `--` ends the flags.
- **Values** take their type from `schema`:
  - `boolean`: a bare flag means true (`--force`); `--force=false` also works.
  - `integer` and `number`: with `minimum` and `maximum`.
  - `enum`: one of the listed values.
  - `pattern`: a string matching the pattern.
  - `type: array`: the flag may be repeated, and its values are collected.
  - `format: duration`: `500ms`, `30s`, `15m`, `2h`.
  - `format: path`: resolved against the working folder.
  - `default`: used when the flag is not given.
  - `required: true`: the flag must be given.
- **Stdin** is the `requestBody`, parsed by its media type (`application/json`, or text). An optional body that sends
  nothing within a short grace period (the reference runner waits 250 ms) counts as no body, because an agent's shell
  may leave stdin open.
- Every command SHOULD take `--json`.

## 4. Outcomes

Each response is one outcome. `x-cli-exit-code` (required, 0–255) is the process's exit code; `x-cli-stream` is
`stdout` (the default) or `stderr`. On a success, `x-cli-when-flag: --json` says the flag that turns the output into
JSON. The status key says what kind of outcome it is. These are the standard outcomes:

| Status | Exit | Stream | Meaning |
| --- | --- | --- | --- |
| `200` | 0 | stdout | Done: the result. With `--json`, one JSON document (a list is an array); else text |
| `202` | 0 | stdout | Queued (`--no-wait`): `{tasks}` |
| `400` | 1 | stderr | Usage: a missing or invalid argument, flag or stdin |
| `404` | 2 | stderr | Not found |
| `409` | 3 | stderr | Conflict: something holds it, or it is still in use |
| `503` | 4 | stderr | Unavailable: a service or tool it needs is not running or not installed |
| `500` | 5 | stderr | Failed: the task or the tool it runs failed |
| `504` | 124 | stderr | Timed out (`--timeout`): queued tasks keep running |

- A success MUST exit 0. A failure (4xx, 5xx) MUST exit non-zero on stderr.
- With `--json`, a failure is `{"error", "status", "hint"?, …}` on stderr. Without it, it is printed as `error:` and
  `hint:` lines. The hint SHOULD say what to do next.
- A status the operation does not declare exits 1 if it is below 500, else 5.

## 5. Conventions (non-normative)

The kit's DSL fills these in, and a document written by hand MAY follow them:

- A command that queues background work takes `--no-wait` (answering at once with 202) and `--timeout`.
- A command that waits long for an answer takes `--timeout`.
- Shared outcomes live in `components.responses` and shared shapes in `components.schemas` (`Error`, `Task`,
  `Queued`).
- Each CLI comes with an agent skill: `<skills>/<binary>/SKILL.md` written by hand, and `references/commands.md`
  generated from the document.

## 6. Extension fields

| Field | Where | Type | Meaning |
| --- | --- | --- | --- |
| `x-cli` | root | object | `binary` (required), `min_version`, `examples` |
| `x-cli-position` | path parameter | integer ≥ 0 | Its place among the positional arguments |
| `x-cli-short` | query parameter | `-x` | A one-letter alias of the flag |
| `x-cli-exit-code` | response | integer 0–255 | The process's exit code |
| `x-cli-stream` | response | `stdout` \| `stderr` | Where the output is written |
| `x-cli-when-flag` | response | string | The flag that makes this output JSON |

## 7. Versioning

The specification follows semantic versioning. This is version 0.1: fields may still change before 1.0, and each
change is listed in [CHANGELOG.md](CHANGELOG.md).
