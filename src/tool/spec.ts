import type { CliDef } from '../dsl.ts';

/** `ocli`: the kit's own command, itself a CLI of this kind (`specs/ocli.openapi.json`). */
export const toolCli: CliDef = {
  binary: 'ocli',
  version: '0.1.0',
  summary: 'Add ready-made CLIs from the library to a project, and check CLI documents.',
  description: `The library holds ready-made CLIs, each an OpenAPI 3.1 document with x-cli-* extensions, its handlers and an
agent skill. add copies one into your project: you own the code and may change it. lint checks a CLI document against
the conventions (SPEC.md) and the extension schema; reference writes the command reference of a skill from one.`,
  examples: [
    'ocli list',
    'ocli add magick',
    'ocli add magick --as img --dir tools --skills-dir .claude/skills --json',
    'ocli lint cli/img/img.openapi.json',
    'ocli reference cli/img/img.openapi.json > .agents/skills/img/references/commands.md',
  ],
  schemas: {
    Item: {
      type: 'object',
      required: ['name', 'binary', 'summary'],
      properties: {
        name: { type: 'string', description: 'What to add it by' },
        binary: { type: 'string', description: 'Its binary, unless renamed with --as' },
        summary: { type: 'string' },
        requires: { type: 'array', items: { type: 'string' }, description: 'Tools it runs, to be installed on the machine' },
      },
    },
    Added: {
      type: 'object',
      required: ['item', 'binary', 'files', 'next'],
      properties: {
        item: { type: 'string' },
        binary: { type: 'string' },
        files: { type: 'array', items: { type: 'string' }, description: 'The files written' },
        bin: { type: 'string', description: 'The launcher, as added to package.json bin' },
        next: { type: 'array', items: { type: 'string' }, description: 'What is left to do' },
      },
    },
  },
  ops: [
    {
      id: 'list',
      cmd: 'list',
      method: 'get',
      summary: 'The CLIs of the library',
      result: { description: 'The library items', schema: 'Item', list: true },
    },
    {
      id: 'add',
      cmd: 'add',
      method: 'post',
      summary: 'Copy a library CLI into this project: its code, its spec, a launcher and its skill',
      description: `Writes <dir>/<binary>/ (the source files, <binary>.openapi.json and bin.mjs) and <skills-dir>/<binary>/ (SKILL.md and
references/commands.md), and adds the launcher to package.json bin. The code imports openapi-cli-kit, and the launcher
runs TypeScript with tsx: install both. Refused (exit 3) when something is there already, unless --force.`,
      args: [{ name: 'item', description: 'The library item (ocli list)' }],
      flags: [
        { name: '--as', description: 'Another binary name for it (every mention renamed)', schema: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' } },
        { name: '--dir', short: '-d', description: 'The folder for the code, one folder per CLI', schema: { type: 'string', default: 'cli' } },
        { name: '--skills-dir', description: 'The folder of the agent skills', schema: { type: 'string', default: '.agents/skills' } },
        { name: '--force', short: '-f', description: 'Overwrite what is there', schema: { type: 'boolean', default: false } },
        { name: '--no-package', description: 'Leave package.json as it is', schema: { type: 'boolean', default: false } },
      ],
      result: { description: 'What was written and what is left to do', schema: 'Added' },
    },
    {
      id: 'lint',
      cmd: 'lint',
      method: 'get',
      summary: 'Check a CLI document against the conventions and the extension schema',
      args: [{ name: 'spec', description: 'The <binary>.openapi.json file', schema: { type: 'string', format: 'path' } }],
      result: { description: 'The document is fine' },
    },
    {
      id: 'reference',
      cmd: 'reference',
      method: 'get',
      summary: "A CLI document's commands as markdown (a skill's references/commands.md)",
      args: [{ name: 'spec', description: 'The <binary>.openapi.json file', schema: { type: 'string', format: 'path' } }],
      result: { description: 'The markdown' },
    },
  ],
};
