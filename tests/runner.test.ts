import { describe, it, expect } from 'vitest';
import { CliError, buildSpec, lintSpec, parseDuration, plainText, runCli, type CliDef, type Handlers, type Io } from '../src/index.ts';

/** A small CLI to drive the runner with. */
const def: CliDef = {
  binary: 'tool',
  version: '2.1.0',
  summary: 'A test tool',
  description: 'For the runner tests.',
  examples: ['tool item get a1 --json | jq .name', 'tool item ls --json'],
  schemas: {},
  ops: [
    { id: 'listItems', cmd: 'item ls', method: 'get', summary: 'The items', result: { description: 'The items', list: true } },
    {
      id: 'getItem',
      cmd: 'item get',
      method: 'get',
      summary: 'One item',
      args: [{ name: 'id', description: 'Its id', schema: { type: 'string', pattern: '^[a-z0-9]+$' } }],
      flags: [
        { name: '--count', short: '-n', description: 'How many', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: '--tag', description: 'A tag', schema: { type: 'array', items: { type: 'string' } } },
        { name: '--kind', description: 'Its kind', schema: { type: 'string', enum: ['a', 'b'] } },
        { name: '--wait', description: 'How long', schema: { type: 'string', format: 'duration', default: '2m' } },
        { name: '--out', description: 'Where', schema: { type: 'string', format: 'path' } },
        { name: '--loud', description: 'Shout', schema: { type: 'boolean', default: false } },
      ],
      result: { description: 'The item' },
    },
    {
      id: 'setItem',
      cmd: 'item set',
      method: 'put',
      summary: 'Store an item',
      args: [{ name: 'id', description: 'Its id' }],
      body: { mediaType: 'application/json', description: 'the item as JSON', required: true },
      result: { description: 'The item' },
    },
    { id: 'runItem', cmd: 'item run', method: 'post', summary: 'Run it', args: [{ name: 'id', description: 'Its id' }], job: { timeout: '5m' }, result: { description: 'Done' } },
  ],
};
const spec = buildSpec(def);

function io(stdin: string | null = null): Io & { out: string; err: string } {
  const sink = { out: '', err: '' };
  return Object.assign(sink, {
    stdout: (t: string) => void (sink.out += t),
    stderr: (t: string) => void (sink.err += t),
    readStdin: async () => stdin,
    cwd: '/work',
    env: {},
  });
}

const seen: Record<string, unknown>[] = [];
const handlers: Handlers = {
  listItems: async () => ({ body: [{ id: 'a1' }, { id: 'b2' }] }),
  getItem: async ({ args, flags }) => (seen.push({ args, flags }), args.id === 'missing' ? Promise.reject(new CliError(404, 'No item missing', 'tool item ls')) : { body: { id: args.id, name: 'Item' } }),
  setItem: async ({ body }) => ({ body }),
  runItem: async ({ flags }) => (flags['no-wait'] ? { status: 202, body: { tasks: [{ id: 't1' }] } } : { body: { done: true } }),
};

describe('the CLI runner', () => {
  it('parses positionals and flags by the spec: shorts, repeats, enums, durations, paths, booleans, defaults', async () => {
    seen.length = 0;
    const sink = io();
    expect(await runCli(spec, handlers, ['item', 'get', 'a1', '-n', '3', '--tag', 'x', '--tag=y', '--kind', 'b', '--wait', '90s', '--out', 'pics/a.png', '--loud'], sink)).toBe(0);
    expect(seen[0]).toEqual({ args: { id: 'a1' }, flags: { count: 3, tag: ['x', 'y'], kind: 'b', wait: 90_000, out: '/work/pics/a.png', loud: true, json: false } });
    await runCli(spec, handlers, ['item', 'get', 'a1'], io());
    expect(seen[1]).toEqual({ args: { id: 'a1' }, flags: { count: 1, wait: 120_000, loud: false, json: false } });
    expect(parseDuration('1.5h')).toBe(5_400_000);
  });

  it('refuses bad usage with exit 1 on stderr, as JSON with --json', async () => {
    for (const argv of [['item', 'get'], ['item', 'get', 'A!'], ['item', 'get', 'a1', '--count', '0'], ['item', 'get', 'a1', '--kind', 'c'], ['item', 'get', 'a1', '--nope'], ['item', 'get', 'a1', 'extra'], ['item', 'get', 'a1', '--wait', 'soon']]) {
      const sink = io();
      expect(await runCli(spec, handlers, [...argv, '--json'], sink)).toBe(1);
      expect(sink.out).toBe('');
      expect(JSON.parse(sink.err)).toMatchObject({ status: 400, error: expect.any(String) });
    }
    const sink = io();
    expect(await runCli(spec, handlers, ['what'], sink)).toBe(1);
    expect(sink.err).toMatch(/Unknown command "what"[\s\S]*hint: tool --help/);
  });

  it('prints the result as one JSON document with --json (a list as an array), else as text', async () => {
    let sink = io();
    await runCli(spec, handlers, ['item', 'get', 'a1', '--json'], sink);
    expect(JSON.parse(sink.out)).toEqual({ id: 'a1', name: 'Item' });
    sink = io();
    await runCli(spec, handlers, ['item', 'ls', '--json'], sink);
    expect(JSON.parse(sink.out)).toEqual([{ id: 'a1' }, { id: 'b2' }]);
    sink = io();
    await runCli(spec, handlers, ['item', 'get', 'a1'], sink);
    expect(sink.out).toBe('id: a1\nname: Item\n');
    expect(plainText({ list: ['a', 'b'], nested: { x: 1 }, rows: [{ a: 1 }] })).toBe('list: a, b\nnested:\n  x: 1\nrows:\n  -\n    a: 1\n');
  });

  it("maps a handler's failure to its response's exit code, with the hint", async () => {
    const sink = io();
    expect(await runCli(spec, handlers, ['item', 'get', 'missing'], sink)).toBe(2);
    expect(sink.err).toBe('error: No item missing\nhint: tool item ls\n');
    const json = io();
    await runCli(spec, handlers, ['item', 'get', 'missing', '--json'], json);
    expect(JSON.parse(json.err)).toEqual({ error: 'No item missing', status: 404, hint: 'tool item ls' });
  });

  it('reads the request body from stdin, parsed by its media type', async () => {
    let sink = io('{"name":"x"}');
    expect(await runCli(spec, handlers, ['item', 'set', 'a1', '--json'], sink)).toBe(0);
    expect(JSON.parse(sink.out)).toEqual({ name: 'x' });
    sink = io(null);
    expect(await runCli(spec, handlers, ['item', 'set', 'a1'], sink)).toBe(1);
    expect(sink.err).toMatch(/Pipe the item as JSON into stdin/);
    sink = io('{nope');
    expect(await runCli(spec, handlers, ['item', 'set', 'a1'], sink)).toBe(1);
  });

  it('answers a job queued with --no-wait as accepted (exit 0)', async () => {
    const sink = io();
    expect(await runCli(spec, handlers, ['item', 'run', 'a1', '--no-wait', '--json'], sink)).toBe(0);
    expect(JSON.parse(sink.out)).toEqual({ tasks: [{ id: 't1' }] });
  });

  it('describes itself: the overview, a group, one command, the version', async () => {
    let sink = io();
    expect(await runCli(spec, handlers, [], sink)).toBe(0);
    expect(sink.out).toMatch(/tool 2\.1\.0: A test tool/);
    expect(sink.out).toMatch(/· item ls \[flags\]\s+The items/);
    expect(sink.out).toMatch(/\* item set <id> \[flags\]\s+Store an item/);
    expect(sink.out).toMatch(/124\s+Timed out/);
    sink = io();
    await runCli(spec, handlers, ['item', 'get', '--help'], sink);
    expect(sink.out).toMatch(/Usage: tool item get <id> \[flags\]/);
    expect(sink.out).toMatch(/-n, --count\s+integer\s+How many \(default 1\)/);
    expect(sink.out).toMatch(/--tag\s+string…\s+A tag \(repeatable\)/);
    expect(sink.out).toMatch(/tool item get a1 --json \| jq .name/);
    expect(sink.out).not.toMatch(/tool item ls --json/);
    sink = io();
    await runCli(spec, handlers, ['item'], sink);
    expect(sink.out).toMatch(/item ls[\s\S]*item run/);
    sink = io();
    await runCli(spec, handlers, ['--version'], sink);
    expect(sink.out).toBe('2.1.0\n');
  });

  it('builds specs that keep to the conventions, and finds what breaks them', () => {
    expect(lintSpec(spec)).toEqual([]);
    const broken = structuredClone(spec);
    const get = broken.paths['/item/get/{id}'].get!;
    (get.parameters![0] as any)['x-cli-position'] = 3;
    (get.parameters![1] as any)['x-cli-short'] = '--n';
    (get.responses as any)['404'] = { description: 'x', 'x-cli-exit-code': 0, 'x-cli-stream': 'stdout' };
    broken.paths['/item/{id}/oops'] = { get: { operationId: 'getItem', summary: '', parameters: [], responses: { 200: { description: '', 'x-cli-exit-code': 0 } } } };
    broken['x-cli'].examples = ['tool fly away'];
    expect(lintSpec(broken)).toEqual([
      'GET /item/get/{id}: id needs x-cli-position 0 (its place in the path)',
      'GET /item/get/{id} --count x-cli-short: must match ^-[a-zA-Z0-9]$',
      'GET /item/get/{id} 404: a failure exits non-zero on stderr',
      '/item/{id}/oops: the subcommand words must come before the {arguments}',
      'GET /item/{id}/oops: operationId getItem is used twice',
      'GET /item/{id}/oops: {id} has no path parameter',
      'example calls no command: tool fly away',
    ]);
  });
});
