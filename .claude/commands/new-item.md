---
description: Create a new library item (a ready-made CLI with its agent skill) by the scheme of CONTRIBUTING.md
argument-hint: <name> <what it wraps, e.g. "ffmpeg: trim, concat and convert clips">
---

Create a new openapi-cli-kit library item: $ARGUMENTS

Use the first word of the arguments as the item's name (lowercase, dashes). The rest says what it wraps. If no name
or purpose is given, ask for them before writing anything.

1. **Read the scheme first.** Read CONTRIBUTING.md ("Adding a library item"), then SPEC.md sections 2–4. Read
   `library/imagemagick/` (`item.ts`, `spec.ts`, `handlers.ts`, `SKILL.md`) and `library/imagemagick/test/handlers.test.ts` as the model to
   follow.
2. **Scaffold it** with `npm run new-item -- <name> --summary "<one line>"`. This writes `library/<name>/`
   (`item.ts`, `spec.ts`, `handlers.ts`, `SKILL.md`, and `test/handlers.test.ts`) and registers the item in
   `library/index.ts`. Add `--binary <binary>` if `<name>-cli` doesn't fit.
3. **Design the commands** before you code them. Present a short list (command, `get` or `post`, arguments, flags,
   result) and wait for the user's go-ahead.
   - Each command does one task well. Use words a user would use, and typed flags (`enum`, `minimum`, `pattern`,
     `format: path`). Pixel or unit conventions go in the descriptions.
   - Every flag of the wrapped tool doesn't need a command. Cover what agents need, and leave the rest to the tool
     itself.
4. **Write `spec.ts`** with the DSL. Use a `writes()`-style helper for commands that write `--out`, as `imagemagick` does.
   Examples must call real commands.
5. **Write `handlers.ts`.**
   - Import only from `openapi-cli-kit` and Node built-ins.
   - Run the tool with `execFile` and argument arrays, behind an injectable runner, and let an environment variable
     point at another binary.
   - Map failures: 404 for a missing input file, 400 for bad values and the tool's own usage errors, 503 for a tool
     that isn't installed (with an install hint), and 500 when the tool itself fails.
   - Probe the tool's real output (versions, formats, exit codes) by running it, rather than assuming.
6. **Fill in `item.ts`:** `requires`, with the binary and how to install it.
7. **Write `SKILL.md`** for an agent that has never seen the tool:
   - frontmatter (`name` = the binary, and a description of what it does and when to use it);
   - when to use it and when not;
   - what each command does, with its conventions;
   - the rules (`--json`, exit codes);
   - recipes in `bash` blocks that parse.
8. **Write the tests** in `library/<name>/test/<source-file>.test.ts`, one focused test file per source file. Check
   the argument lists through a fake runner, and the error
   mapping. Add real checks under `describe.skipIf(!hasTool)`.
9. **Update the docs:** add a row to README.md's library table and a line to CHANGELOG.md.
10. **Run `npm run check`** until it passes. Then try the item for real: add it to a scratch folder with
    `node bin/ocli.mjs add <name>` and run its launcher there.

Report the commands, what was verified for real, and anything left as TODO.
