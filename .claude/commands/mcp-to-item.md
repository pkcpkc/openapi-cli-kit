---
description: Turn an MCP server into a library item (one CLI command per tool, with its agent skill)
argument-hint: <name> <"stdio command" | https://url> [env vars or headers it needs]
---

Turn an MCP server into an openapi-cli-kit library item: $ARGUMENTS

The first word of the arguments is the item's name (lowercase, dashes). Then comes the server: a stdio command line
(for example `npx -y @modelcontextprotocol/server-everything`) or a Streamable HTTP URL. Then any environment
variables or headers it needs. If the server is unclear, ask before you run anything.

1. **Read the scheme first.**
   - CONTRIBUTING.md ("Adding a library item").
   - `src/mcp.ts`, which explains how tools become commands: one kebab-case command per tool, a flag per input
     property, `--input` and stdin for the whole object, `get` for read-only tools.
   - `library/imagemagick/SKILL.md`, as the standard for a skill.
2. **Check the server before starting it.** A stdio command runs on this machine. Tell the user what will run and
   confirm, unless they gave the exact command themselves.
3. **Generate the item:**
   - stdio: `npm run new-item -- <name> --mcp-command "<command line>" [--mcp-env TOKEN_NAME …]`
   - HTTP: `npm run new-item -- <name> --mcp-url <url> [--mcp-header "Authorization: Bearer ${env:TOKEN_NAME}" …]`

   Secrets go in only as `${env:NAME}` references, never as values. The script connects, lists the tools, and writes:
   - `library/<name>/spec.ts`: `SERVER`, `COMMANDS`, `REQUIRED` and the `CliDef`;
   - `handlers.ts`: `mcpHandlers()`;
   - `SKILL.md`, `item.ts` and `test/handlers.test.ts` inside `library/<name>/`.

   It also registers the item. If it fails, report the server's error and stop.
4. **Review what it made**, in `spec.ts` and `item.ts`:
   - Summaries: keep them short and useful. Rewrite the long ones that tool descriptions often produce.
   - Commands: drop tools that make no sense on a command line, and rename unclear command words in both `ops` and
     `COMMANDS`.
   - Flags: give enums and limits where the tool's schema left them out.
   - Mark read-only tools `get`, and keep `post` for anything that changes state.
   - `requires` in `item.ts`: say how to install the server's command.
5. **Make `SKILL.md` worth reading.** Write a real description of what the server is for and when to use it, plus
   rules specific to this server (authentication, rate limits, IDs and where they come from). Add recipes that
   chain commands with `--json | jq`. Remove every TODO.
6. **Try it for real.** Call one read-only command through the handlers, or add the item to a scratch folder with
   `node bin/ocli.mjs add <name>` and run its launcher. Then run `npm run check` until it passes.
7. **Update the docs:** add a row to README.md's library table and a line to CHANGELOG.md.

Report the commands made (and dropped), what was tried for real, and what the user must set up, such as environment
variables or the server's install.
