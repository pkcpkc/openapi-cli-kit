# ocli commands

<!-- Generated from specs/ocli.openapi.json: do not edit by hand. -->

Add ready-made CLIs from the library to a project, and check CLI documents. Every command takes `--json` (the result as JSON on stdout, errors as JSON on stderr) and `--help`.

Reads only (safe to run without asking): `ocli list`, `ocli lint`, `ocli reference`.

## `ocli list [flags]`

The CLIs of the library *(reads only)*

Exit codes: 0, 1, 4. Prints: The library items.

## `ocli add <item> [flags]`

Copy a library CLI into this project: its code, its spec, a launcher and its skill

Writes <dir>/<binary>/ (the source files, full <binary>.openapi.json, any focused profile schemas and bin.mjs)
and <skills-dir>/<binary>/ (SKILL.md, references/commands.md and profile references), and adds the launcher to package.json bin.
Profiles are scoped OpenAPI views, not separate binaries; load only the profile needed for an agent task. The code imports
openapi-cli-kit, and the launcher runs TypeScript with tsx: install both. Refused (exit 3) when something is there already, unless --force.

| Argument | Type | Meaning |
| --- | --- | --- |
| `<item>` | string | The library item (ocli list) |
| `--as` | string | Another binary name for it (every mention renamed) |
| `-d, --dir` | string | The folder for the code, one folder per CLI (default `"cli"`) |
| `--skills-dir` | string | The folder of the agent skills (default `".agents/skills"`) |
| `-f, --force` | boolean | Overwrite what is there (default `false`) |
| `--no-package` | boolean | Leave package.json as it is (default `false`) |

Exit codes: 0, 1, 2, 3, 4. Prints: What was written and what is left to do.

## `ocli lint <spec> [flags]`

Check a CLI document against the conventions and the extension schema *(reads only)*

| Argument | Type | Meaning |
| --- | --- | --- |
| `<spec>` | path | The <binary>.openapi.json file |

Exit codes: 0, 1, 2, 4. Prints: The document is fine.

## `ocli reference <spec> [flags]`

A CLI document's commands as markdown (a skill's references/commands.md) *(reads only)*

| Argument | Type | Meaning |
| --- | --- | --- |
| `<spec>` | path | The <binary>.openapi.json file |

Exit codes: 0, 1, 2, 4. Prints: The markdown.
