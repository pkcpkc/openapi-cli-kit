#!/usr/bin/env node
// A tiny MCP server over stdio for the tests: three tools, a log line on stdout, a ping to the client.
import readline from 'node:readline';

const TOOLS = [
  { name: 'echo_text', description: 'Echo the text back. Handy for tests.', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'What to echo' }, times: { type: 'integer', minimum: 1, default: 1 } }, required: ['text'] }, annotations: { readOnlyHint: true } },
  { name: 'createNote', description: 'Create a note', inputSchema: { type: 'object', properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, meta: { type: 'object' }, json: { type: 'boolean' } }, required: ['title'] } },
  { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
];

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
process.stdout.write('starting up (a log line, not JSON)\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'hello' } });
    send({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' });
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' }, instructions: `Env: ${process.env.FIXTURE_TOKEN ?? 'none'}` } });
  }
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: m.params?.cursor ? { tools: TOOLS.slice(2) } : { tools: TOOLS.slice(0, 2), nextCursor: 'p2' } });
  if (m.method === 'tools/call') {
    const { name, arguments: args } = m.params;
    if (name === 'echo_text') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(args.text).repeat(args.times ?? 1) }] } });
    if (name === 'createNote') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'created' }], structuredContent: args } });
    if (name === 'fail') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'it broke' }], isError: true } });
    return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `Unknown tool ${name}` } });
  }
});
