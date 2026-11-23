import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpec, lintSpec, type CliDef } from '../src/index.ts';
import { McpClient, expandEnv, kebab, mcpCommands, mcpHandlers, withMcp, type McpServer, type McpTool } from '../src/mcp.ts';
import { run } from './helpers.ts';

const FIXTURE: McpServer = { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))], env: { FIXTURE_TOKEN: '${env:TEST_TOKEN}' } };
const env = { ...process.env, TEST_TOKEN: 'secret-1' };

describe('the MCP client', () => {
  it('lists the tools across pages and calls them over stdio, past log lines and server requests', async () => {
    await withMcp(
      FIXTURE,
      async (client) => {
        expect(client.serverInfo?.name).toBe('fixture');
        expect(client.instructions).toBe('Env: secret-1');
        expect((await client.listTools()).map((t) => t.name)).toEqual(['echo_text', 'createNote', 'fail']);
        expect(await client.callTool('echo_text', { text: 'ab', times: 2 })).toEqual({ content: [{ type: 'text', text: 'abab' }] });
        await expect(client.callTool('nope', {})).rejects.toMatchObject({ status: 400 });
      },
      { env }
    );
  });

  it('says what is missing: a variable, the server command', async () => {
    expect(() => expandEnv('${env:NOPE_X}', {})).toThrow(/NOPE_X is not set/);
    await expect(new McpClient({ command: '/no/such/server' }).connect()).rejects.toMatchObject({ status: 503 });
  });

  describe('over Streamable HTTP', () => {
    let server: http.Server | undefined;
    afterEach(() => server?.close());

    it('keeps the session, sends the protocol version, and reads JSON and event-stream answers', async () => {
      const seen: { method: string; session?: string; version?: string }[] = [];
      server = http.createServer((req, res) => {
        let text = '';
        req.on('data', (c) => (text += c));
        req.on('end', () => {
          if (req.method === 'DELETE') return res.writeHead(204).end();
          const m = JSON.parse(text);
          seen.push({ method: m.method, session: req.headers['mcp-session-id'] as string, version: req.headers['mcp-protocol-version'] as string });
          if (req.headers.authorization !== 'Bearer secret-1') return res.writeHead(401).end();
          if (!m.id) return res.writeHead(202).end();
          if (m.method === 'initialize') return res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's-42' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'web' } } }));
          // Event stream: a notification first, then the answer
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
          res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'web_tool', inputSchema: { type: 'object' } }] } })}\n\n`);
        });
      });
      await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
      const tools = await withMcp({ url, headers: { Authorization: 'Bearer ${env:TEST_TOKEN}' } }, (c) => c.listTools(), { env });
      expect(tools.map((t) => t.name)).toEqual(['web_tool']);
      expect(seen).toEqual([
        { method: 'initialize', session: undefined, version: undefined },
        { method: 'notifications/initialized', session: 's-42', version: '2025-06-18' },
        { method: 'tools/list', session: 's-42', version: '2025-06-18' },
      ]);
      await expect(withMcp({ url }, (c) => c.listTools(), { env })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/refused the credentials/) });
    });
  });
});

describe('MCP tools as commands', () => {
  const tools: McpTool[] = [
    { name: 'echo_text', description: 'Echo the text back. Handy for tests.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, times: { type: 'integer', minimum: 1 } }, required: ['text'] }, annotations: { readOnlyHint: true } },
    { name: 'createNote', description: 'Create a note', inputSchema: { type: 'object', properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, meta: { type: 'object' }, json: { type: 'boolean' } }, required: ['title'] } },
    { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
  ];
  const { ops, commands } = mcpCommands(tools);
  const def: CliDef = { binary: 'notes', version: '1.0.0', summary: 'Notes', description: 'Notes over MCP', examples: ['notes echo-text --text hi'], schemas: {}, ops };
  const spec = buildSpec(def);
  const required = { 'echo-text': ['text'], 'create-note': ['title'] };

  it('maps names, types, read-only tools and reserved flags, and lints clean', () => {
    expect(kebab('getIssue_byID.v2')).toBe('get-issue-by-id-v2');
    expect(ops.map((o) => [o.cmd, o.method])).toEqual([['echo-text', 'get'], ['create-note', 'post'], ['fail', 'post']]);
    expect(ops[0].summary).toBe('Echo the text back.');
    expect(commands['create-note']).toEqual({ tool: 'createNote', args: { title: { name: 'title' }, tags: { name: 'tags' }, meta: { name: 'meta', json: true }, 'json-arg': { name: 'json' } } });
    expect(lintSpec(spec)).toEqual([]);
  });

  it('calls the tools through the CLI: flags, JSON flags, --input, and errors', async () => {
    const handlers = mcpHandlers(FIXTURE, commands, required, (s, timeoutMs) => new McpClient(s, { env, timeoutMs }).connect());
    const echo = await run(spec, handlers, ['echo-text', '--text', 'hi', '--times', '3']);
    expect([echo.code, echo.out]).toEqual([0, 'hihihi\n']);
    const note = await run(spec, handlers, ['create-note', '--input', '{"title":"a","tags":["x"]}', '--tags', 'y', '--meta', '{"k":1}', '--json-arg', '--json']);
    expect(note.json().structuredContent).toEqual({ title: 'a', tags: ['y'], meta: { k: 1 }, json: true });
    expect((await run(spec, handlers, ['create-note', '--tags', 'y'])).err).toMatch(/Missing --title/);
    expect((await run(spec, handlers, ['create-note', '--title', 't', '--meta', '{bad'])).code).toBe(1);
    const failed = await run(spec, handlers, ['fail', '--json']);
    expect([failed.code, JSON.parse(failed.err).error]).toEqual([5, 'it broke']);
  });
});

