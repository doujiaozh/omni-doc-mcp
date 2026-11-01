/**
 * Omni-Doc-MCP — MCP server smoke probe (manual, not part of `npm test`).
 *
 * Spawns the stdio MCP server, speaks a short JSON-RPC 2.0 conversation with
 * it and validates every response, including error paths.
 *
 * Run:  npm run build && node dist/tests/mcp-probe.js
 */

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverFile = resolve(here, '..', 'src', 'mcp_server', 'server.js');
const fixturesDir = resolve(here, '..', '..', 'tests', 'fixtures');

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function sse(line: string): string {
  return line + '\n';
}

async function main(): Promise<void> {
  const child = spawn(process.execPath, [serverFile], { stdio: ['pipe', 'pipe', 'pipe'] });

  const responses: JsonRpcResponse[] = [];
  const buffer: string[] = [];

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer.push(chunk);
    const buffered = buffer.join('');
    const lines = buffered.split('\n');
    buffer.length = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        try {
          responses.push(JSON.parse(line));
        } catch {
          console.error('Non-JSON line from server:', line);
        }
      }
    }
    if (lines[lines.length - 1]) buffer.push(lines[lines.length - 1]);
  });
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk.toString()));

  const id = (() => {
    let n = 0;
    return () => ++n;
  })();

  const send = (method: string, params: Record<string, unknown> = {}): number => {
    const messageId = id();
    child.stdin.write(sse(JSON.stringify({ jsonrpc: '2.0', id: messageId, method, params })));
    return messageId;
  };

  const awaitResponse = async (messageId: number, timeoutMs = 15000): Promise<JsonRpcResponse> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = responses.find((r) => r.id === messageId);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for response to message id ${messageId}`);
  };

  let failures = 0;
  const check = (label: string, condition: boolean, extra?: string): void => {
    if (condition) {
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    }
  };

  try {
    // 1. initialize
    const initId = send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'omni-doc-probe', version: '1.0.0' },
    });
    const init = await awaitResponse(initId);
    const initResult = init.result as { protocolVersion: string; serverInfo: { name: string; version: string }; capabilities: Record<string, unknown> } | undefined;
    check('initialize returns server info', !!initResult && initResult.serverInfo.name === 'omni-doc-mcp', JSON.stringify(init));
    check('initialize advertises tools capability', !!initResult && !!initResult.capabilities.tools);

    // initialized notification (no response expected)
    child.stdin.write(sse(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })));

    // 2. tools/list
    const listId = send('tools/list');
    const list = await awaitResponse(listId);
    const listResult = list.result as { tools: Array<{ name: string; description?: string }> };
    const toolNames = listResult.tools.map((t) => t.name);
    check('tools/list exposes read_document', toolNames.includes('read_document'), toolNames.join(', '));
    check('tools/list exposes list_supported_formats', toolNames.includes('list_supported_formats'));

    // 3. tools/call read_document on the PDF fixture
    const callId = send('tools/call', {
      name: 'read_document',
      arguments: { filePath: join(fixturesDir, 'test.pdf') },
    });
    const call = await awaitResponse(callId);
    const callResult = call.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const callText = callResult?.content?.[0]?.text ?? '';
    check('read_document returns markdown content', !callResult.isError && callText.includes('## Page 1'), callText.slice(0, 120));
    check('read_document extracts page 2 text', callText.includes('Second page heading'));

    // 4. tools/call list_supported_formats
    const formatsId = send('tools/call', { name: 'list_supported_formats', arguments: {} });
    const formats = await awaitResponse(formatsId);
    const formatsText = (formats.result as { content: Array<{ type: string; text: string }> })?.content?.[0]?.text ?? '';
    check('list_supported_formats lists pdf/docx/xlsx', ['pdf', 'docx', 'xlsx'].every((f) => formatsText.includes(f)), formatsText.slice(0, 120));

    // 5. unsupported file returns an isError tool result (not a transport error)
    const badId = send('tools/call', { name: 'read_document', arguments: { filePath: join(fixturesDir, 'not-a-real.txt') } });
    const bad = await awaitResponse(badId);
    const badResult = bad.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
    check('unsupported file surfaces isError result', !!badResult.isError && /pdf|docx|xlsx/i.test(badResult.content[0].text), JSON.stringify(bad.result));

    // 6. protocol error handling: malformed JSON
    child.stdin.write('{"jsonrpc": "2.0", id: broken}\n');
    await new Promise((r) => setTimeout(r, 300));
    const parseError = responses.find((r) => r.jsonrpc === '2.0' && r.error?.code === -32700);
    check('malformed JSON returns -32700 Parse error', !!parseError);

    // 7. unknown method returns -32601
    const unknownId = send('tools/nope');
    const unknown = await awaitResponse(unknownId);
    check('unknown method returns -32601', unknown.error?.code === -32601, JSON.stringify(unknown.error));
  } finally {
    child.stdin.end();
    child.kill();
  }

  console.log(failures === 0 ? '\nMCP probe: all checks passed ✓' : `\nMCP probe: ${failures} check(s) failed ✗`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error('MCP probe failed:', error);
  process.exitCode = 1;
});
