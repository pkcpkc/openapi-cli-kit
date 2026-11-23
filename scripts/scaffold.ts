// `npm run new-item -- <name> [flags]`: a new library item, by the scheme of CONTRIBUTING.md (`library/<name>/` with
// item.ts, spec.ts, handlers.ts and SKILL.md, registered in library/index.ts, with tests/<name>.test.ts). With
// --mcp-command or --mcp-url it is made from an MCP server: its tools listed and turned into commands.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSpec, type CliDef } from '../src/dsl.ts';
import { lintSpec } from '../src/runner/lint.ts';
import { mcpCommands, withMcp, type McpServer, type McpTool } from '../src/mcp.ts';

export interface ScaffoldOptions {
  /** The item's name: lowercase letters, digits and dashes. */
  name: string;
  /** Its binary (default `<name>-cli`). */
  binary?: string;
  summary?: string;
  /** Make it from this MCP server. */
  mcp?: McpServer;
  /** The server's tools (default: listed from `mcp`). */
  tools?: McpTool[];
  /** Overwrite an item of that name. */
  force?: boolean;
}

const NAME = /^[a-z][a-z0-9-]*$/;
const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const literal = (value: unknown) => JSON.stringify(value, null, 2).replace(/\n/g, '\n');
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A placeholder value of a schema's type, for an example call. */
function sample(schema: Record<string, any>): unknown {
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type;
  return { integer: 1, number: 1, boolean: true, array: [], object: {} }[type as string] ?? 'value';
}

/** Writes the item's files; returns them. Refuses (throws) when it is there already, unless `force`. */
export async function scaffoldItem(root: string, options: ScaffoldOptions): Promise<string[]> {
  const { name } = options;
  if (!NAME.test(name)) throw new Error(`${name}: an item name is lowercase letters, digits and dashes`);
  const binary = options.binary ?? `${name}-cli`;
  if (!NAME.test(binary)) throw new Error(`${binary}: a binary name is lowercase letters, digits and dashes`);
  const dir = path.join(root, 'library', name);
  if (fs.existsSync(dir) && !options.force) throw new Error(`library/${name} is there already (--force to overwrite)`);

  const files: Record<string, string> = {};
  let requires: { command: string; install: string }[] = [];
  let summary = options.summary ?? `TODO: what ${binary} does, in one line`;

  if (options.mcp) {
    const server = options.mcp;
    let instructions: string | undefined;
    let serverName = name;
    const tools =
      options.tools ??
      (await withMcp(server, async (client) => {
        instructions = client.instructions;
        serverName = client.serverInfo?.name ?? name;
        return client.listTools();
      }));
    if (!tools.length) throw new Error('The MCP server lists no tools');
    const { ops, commands } = mcpCommands(tools);
    const required = Object.fromEntries(tools.map((t, i) => [ops[i].id, t.inputSchema?.required ?? []]).filter(([, r]) => (r as string[]).length));
    summary = options.summary ?? `The ${serverName} MCP server's ${tools.length} tools as commands: ${ops.slice(0, 6).map((o) => o.cmd).join(', ')}${ops.length > 6 ? ', …' : ''}`;
    const def: CliDef = {
      binary,
      version: '0.1.0',
      summary: `${summary}.`,
      description: `Each command calls one tool of the ${serverName} MCP server: it connects (${'url' in server ? server.url : `starts ${server.command}`}), calls the tool and closes. Flags are the tool's arguments; --input (or JSON on stdin) takes them all at once.${instructions ? `\n\n${instructions.trim()}` : ''}`,
      examples: ops.slice(0, 3).map((o, i) => `${binary} ${o.cmd} --input '${JSON.stringify(Object.fromEntries((tools[i].inputSchema?.required ?? []).map((r) => [r, sample(tools[i].inputSchema.properties?.[r] ?? {})])))}' --json`),
      schemas: {},
      ops,
    };
    const problems = lintSpec(buildSpec(def));
    if (problems.length) throw new Error(`The generated spec does not lint:\n  ${problems.join('\n  ')}`);
    requires = 'command' in server ? [{ command: server.command, install: `TODO: how to install ${server.command}` }] : [];
    files['spec.ts'] = `import type { CliDef, McpCommand, McpServer } from 'openapi-cli-kit';

/**
 * \`${binary}\`: the ${serverName} MCP server as a CLI, one command per tool (made by \`npm run new-item -- ${name} --mcp-…\`).
 * Edit freely: the summaries, which tools to keep, the flags. Strings in SERVER may hold \`\${env:NAME}\`.
 */

/** Where the server is. */
export const SERVER: McpServer = ${literal(server)};

/** Each command's tool, and its flags' arguments. */
export const COMMANDS: Record<string, McpCommand> = ${literal(commands)};

/** The arguments each tool needs. */
export const REQUIRED: Record<string, string[]> = ${literal(required)};

export const cli: CliDef = ${literal(def)};
`;
    files['handlers.ts'] = `import { mcpHandlers, type Handlers } from 'openapi-cli-kit';
import { COMMANDS, REQUIRED, SERVER } from './spec.ts';

/** Each command connects to the server, calls its tool and closes. */
export const handlers = (): Handlers => mcpHandlers(SERVER, COMMANDS, REQUIRED);
`;
    const lines = ops.map((o, i) => `- **${o.cmd}** (${tools[i].name})${o.method === 'get' ? ' reads only.' : ''} ${o.summary}`);
    files['SKILL.md'] = `---
name: ${binary}
description: The ${serverName} MCP server's tools as the \`${binary}\` CLI, one command per tool (${ops.slice(0, 5).map((o) => o.cmd).join(', ')}${ops.length > 5 ? ', …' : ''}). TODO: say what it is for and when to use it.
---

# ${binary}: the ${serverName} MCP server as a CLI

Each command calls one tool of the ${serverName} MCP server: it connects, calls the tool, prints the result and closes.
Commands and flags are listed in [references/commands.md](references/commands.md), and
\`${binary} <command> --help\` shows one command.

## Commands

${lines.join('\n')}

## Rules

- Flags are the tool's arguments (kebab-case). \`--input '{…}'\`, or JSON on stdin, gives them all at once; flags
  override its fields. Arguments marked (JSON) take JSON text.
- Add \`--json\` to get the result as the server gives it: \`content\` (text, images) and \`structuredContent\`.
- Exit codes: 0 done, 1 a missing or invalid argument, 4 the server can't be started or reached (tell the user),
  5 the tool failed (its message says why), 124 timed out (raise \`--timeout\`).
- Commands that change something are marked \`*\` in \`--help\`. Ask before running them unless the user said so.

## Recipes

\`\`\`bash
${def.examples.join('\n')}
\`\`\`
`;
    files[`../../tests/${name}.test.ts`] = `import { describe, it, expect } from 'vitest';
import { buildSpec, runCli, type Io, type McpClient } from '../src/index.ts';
import { mcpHandlers } from '../src/mcp.ts';
import { COMMANDS, REQUIRED, SERVER, cli } from '../library/${name}/spec.ts';

const spec = buildSpec(cli);

/** Runs a command against a fake server that records the calls. */
async function call(argv: string[]) {
  const calls: { name: string; args: unknown }[] = [];
  const fake = { callTool: async (name: string, args: unknown) => (calls.push({ name, args }), { content: [{ type: 'text', text: 'ok' }] }), close: async () => undefined } as unknown as McpClient;
  const sink = { out: '', err: '' };
  const io: Io = { stdout: (t) => void (sink.out += t), stderr: (t) => void (sink.err += t), readStdin: async () => null, cwd: process.cwd(), env: {} };
  const code = await runCli(spec, mcpHandlers(SERVER, COMMANDS, REQUIRED, async () => fake), argv, io);
  return { code, calls, ...sink };
}

describe('${binary}', () => {
  it.each(Object.entries(COMMANDS))('%s calls its tool with --input', async (id, command) => {
    const args = Object.fromEntries((REQUIRED[id] ?? []).map((r) => [r, 'x']));
    const { code, calls } = await call([id, '--input', JSON.stringify(args)]);
    expect(code).toBe(0);
    expect(calls).toEqual([{ name: command.tool, args }]);
  });
});
`;
  } else {
    files['spec.ts'] = `import type { CliDef } from 'openapi-cli-kit';

/** \`${binary}\`: TODO what it wraps and why. Commands are defined with the DSL (SPEC.md, README.md). */
export const cli: CliDef = {
  binary: '${binary}',
  version: '0.1.0',
  summary: ${quote(summary)},
  description: \`TODO: the overview --help prints: what it reads and writes, what it needs on the machine.\`,
  examples: ['${binary} version --json'],
  schemas: {},
  ops: [
    {
      id: 'version',
      cmd: 'version',
      method: 'get',
      summary: 'The version of the tool it runs',
      result: { description: 'The version' },
    },
  ],
};
`;
    files['handlers.ts'] = `import { execFile } from 'node:child_process';
import { CliError, type Handlers } from 'openapi-cli-kit';

/** One call of the tool: its exit code and output. Injectable, so tests run without it. */
export type ToolRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Runs the tool with an argument array (no shell). TODO: its binary, and an environment variable to point elsewhere. */
export const toolRunner =
  (bin = 'TODO-binary'): ToolRun =>
  (args) =>
    new Promise((resolve, reject) =>
      execFile(bin, args, (err, stdout, stderr) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return reject(new CliError(503, \`\${bin} is not installed\`, 'TODO: how to install it'));
        resolve({ code: err ? Number((err as NodeJS.ErrnoException).code) || 1 : 0, stdout: String(stdout), stderr: String(stderr) });
      })
    );

export function ${camel(name)}Handlers(run: ToolRun = toolRunner()): Handlers {
  return {
    version: async () => {
      const { code, stdout, stderr } = await run(['--version']);
      if (code) throw new CliError(500, stderr.trim() || \`exited with \${code}\`);
      return { body: { version: stdout.trim() }, text: stdout };
    },
  };
}

/** The handlers, as the launcher takes them. */
export const handlers = (): Handlers => ${camel(name)}Handlers();
`;
    files['SKILL.md'] = `---
name: ${binary}
description: TODO what ${binary} does with what, and when an agent should use it (and when not). Name the tasks it is for, in the words a user would use.
---

# ${binary}

TODO: one paragraph: what it wraps, what it reads and writes. The commands are listed in
[references/commands.md](references/commands.md), and \`${binary} <command> --help\` shows one command.

## When to use it, and when not

- TODO

## Rules

- Add \`--json\` and read the result's fields.
- Exit codes: 0 done, 1 usage, 2 not found, 4 the tool is not installed (tell the user), 5 it failed.

## Recipes

\`\`\`bash
${binary} version --json
\`\`\`
`;
    files[`../../tests/${name}.test.ts`] = `import { describe, it, expect } from 'vitest';
import { buildSpec, runCli, type Io } from '../src/index.ts';
import { ${camel(name)}Handlers, type ToolRun } from '../library/${name}/handlers.ts';
import { cli } from '../library/${name}/spec.ts';

const spec = buildSpec(cli);

async function run(handlers: ReturnType<typeof ${camel(name)}Handlers>, argv: string[]) {
  const sink = { out: '', err: '' };
  const io: Io = { stdout: (t) => void (sink.out += t), stderr: (t) => void (sink.err += t), readStdin: async () => null, cwd: process.cwd(), env: {} };
  return { code: await runCli(spec, handlers, argv, io), ...sink };
}

describe('${binary}', () => {
  it('reports the version of the tool', async () => {
    const calls: string[][] = [];
    const fake: ToolRun = async (args) => (calls.push(args), { code: 0, stdout: '1.2.3\\n', stderr: '' });
    const { code, out } = await run(${camel(name)}Handlers(fake), ['version', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ version: '1.2.3' });
    expect(calls).toEqual([['--version']]);
  });
});
`;
  }

  files['item.ts'] = `import type { LibraryItem } from '../../src/library.ts';
import { cli } from './spec.ts';

export const ${camel(name)}: LibraryItem = {
  name: '${name}',
  binary: cli.binary,
  summary: ${quote(summary)},
  def: cli,
  files: ['spec.ts', 'handlers.ts'],
  requires: ${literal(requires)},
};
`;

  const written: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const target = path.resolve(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
    written.push(target);
  }

  // Register it in library/index.ts
  const indexFile = path.join(root, 'library', 'index.ts');
  let index = fs.readFileSync(indexFile, 'utf8');
  const ident = camel(name);
  if (!index.includes(`from './${name}/item.ts'`)) {
    index = index.replace(/((?:import .*\n)+)/, `$1import { ${ident} } from './${name}/item.ts';\n`);
    index = index.replace(/export const ITEMS: LibraryItem\[\] = \[([^\]]*)\];/, (_, list: string) => `export const ITEMS: LibraryItem[] = [${[...list.split(',').map((s) => s.trim()).filter(Boolean), ident].join(', ')}];`);
    fs.writeFileSync(indexFile, index, 'utf8');
    written.push(indexFile);
  }
  return written;
}

/** `--mcp-command "npx -y some-server --flag"` as a command and its arguments (quotes kept together). */
export function commandLine(text: string): { command: string; args: string[] } {
  const words = [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  if (!words.length) throw new Error('--mcp-command is empty');
  return { command: words[0], args: words.slice(1) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      binary: { type: 'string' },
      summary: { type: 'string' },
      'mcp-command': { type: 'string' },
      'mcp-url': { type: 'string' },
      'mcp-env': { type: 'string', multiple: true },
      'mcp-header': { type: 'string', multiple: true },
      force: { type: 'boolean' },
    },
  });
  const [name] = positionals;
  if (!name) {
    console.error('usage: npm run new-item -- <name> [--binary b] [--summary s] [--mcp-command "cmd args" | --mcp-url url] [--mcp-env NAME …] [--mcp-header "Name: value" …] [--force]');
    process.exit(1);
  }
  // --mcp-env NAME passes the variable through to the server as ${env:NAME}, never its value
  const env = Object.fromEntries((values['mcp-env'] ?? []).map((n) => [n, `\${env:${n}}`]));
  const headers = Object.fromEntries((values['mcp-header'] ?? []).map((h) => [h.slice(0, h.indexOf(':')).trim(), h.slice(h.indexOf(':') + 1).trim()]));
  const mcp: McpServer | undefined = values['mcp-url']
    ? { url: values['mcp-url'], ...(Object.keys(headers).length ? { headers } : {}) }
    : values['mcp-command']
      ? { ...commandLine(values['mcp-command']), ...(Object.keys(env).length ? { env } : {}) }
      : undefined;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const written = await scaffoldItem(root, { name, binary: values.binary, summary: values.summary, mcp, force: values.force });
    for (const file of written) console.log(`Wrote ${path.relative(root, file)}`);
    console.log('Next: fill in the TODOs, then npm run check');
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  }
}
