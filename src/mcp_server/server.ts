/**
 * Omni-Doc-MCP — a featherweight Model Context Protocol (MCP) server.
 *
 * Zero SDK dependencies: the protocol is just newline-delimited JSON-RPC 2.0
 * over stdio, which Node's built-in streams and `readline` handle natively.
 *
 * Exposed tools:
 *   - read_document(filePath, outputFormat?, maxPages?) → Markdown / JSON text
 *   - list_supported_formats()                          → supported format list
 *
 * Protocol reference: https://modelcontextprotocol.io (spec 2024-11-05+)
 */

import * as readline from 'node:readline';
import { listSupportedFormats, parseDocument } from '../doc_parsers/index.js';
import { DocumentParseError, UnsupportedFormatError } from '../doc_parsers/index.js';

const SERVER_NAME = 'omni-doc-mcp';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const KNOWN_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown> | unknown[];
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface ToolSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolSchema;
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'read_document',
    description:
      'Parse a local document (PDF, DOCX, XLSX, XLS or CSV) and return its content as clean, LLM-friendly Markdown. Use this whenever an AI agent needs to read the real content of a document file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or relative path of the document file to parse.',
        },
        outputFormat: {
          type: 'string',
          enum: ['markdown', 'json'],
          default: 'markdown',
          description: 'Return shape: "markdown" (default) for prose, "json" for the structured view.',
        },
        maxPages: {
          type: 'number',
          default: 0,
          description: 'PDF only: stop after this many pages. 0 (default) parses every page.',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_supported_formats',
    description: 'List every document format this server can parse, with extensions and MIME types.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const send = (payload: unknown): void => {
  process.stdout.write(JSON.stringify(payload) + '\n');
};

const result = (id: string | number | null | undefined, value: unknown): void => {
  if (id === undefined) return; // notification — no response allowed
  send({ jsonrpc: '2.0', id, result: value });
};

const error = (id: string | number | null | undefined, err: JsonRpcError): void => {
  if (id === undefined) return;
  send({ jsonrpc: '2.0', id, error: err });
};

const PROTOCOL_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

function handleInitialize(id: string | number | null | undefined, params: JsonRpcRequest['params']): void {
  const requested = (params as { protocolVersion?: string } | null | undefined)?.protocolVersion;
  const protocolVersion =
    typeof requested === 'string' && KNOWN_PROTOCOL_VERSIONS.has(requested) ? requested : DEFAULT_PROTOCOL_VERSION;

  result(id, {
    protocolVersion,
    capabilities: {
      tools: {},
      logging: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    instructions:
      'Universal document parser: use read_document(filePath) to extract Markdown from PDF / Word / Excel files, and list_supported_formats() to see what is supported. No Java, no Python — pure Node.js.',
  });
}

async function handleToolsList(id: string | number | null | undefined): Promise<void> {
  result(id, { tools: TOOLS });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function handleToolsCall(id: string | number | null | undefined, params: JsonRpcRequest['params']): Promise<void> {
  const call = params as { name?: string; arguments?: Record<string, unknown> } | null | undefined;
  const toolName = asString(call?.name);
  const args = call?.arguments ?? {};

  if (!toolName) {
    error(id, { code: PROTOCOL_ERROR.INVALID_PARAMS, message: "Missing required parameter 'name' in tools/call." });
    return;
  }

  if (toolName === 'list_supported_formats') {
    const payload = { formats: listSupportedFormats() };
    result(id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      isError: false,
    });
    return;
  }

  if (toolName === 'read_document') {
    const filePath = asString((args as Record<string, unknown>).filePath);
    if (!filePath) {
      error(id, {
        code: PROTOCOL_ERROR.INVALID_PARAMS,
        message: "Tool 'read_document' requires argument 'filePath' (non-empty string).",
      });
      return;
    }
    const outputFormat = asString((args as Record<string, unknown>).outputFormat) === 'json' ? 'json' : 'markdown';
    const maxPages = asPositiveNumber((args as Record<string, unknown>).maxPages);

    try {
      const parsed = await parseDocument(filePath, { outputFormat, ...(maxPages ? { maxPages } : {}) });
      const text =
        outputFormat === 'json'
          ? JSON.stringify({ format: parsed.format, json: parsed.json, meta: parsed.meta }, null, 2)
          : parsed.markdown;
      result(id, { content: [{ type: 'text', text }], isError: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Tool-level failures are reported as isError results, not transport errors.
      result(id, { content: [{ type: 'text', text: `omni-doc-mcp: ${message}` }], isError: true });
    }
    return;
  }

  error(id, { code: PROTOCOL_ERROR.METHOD_NOT_FOUND, message: `Unknown tool: ${toolName}` });
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { id, method, params } = request;

  if (method === undefined || typeof method !== 'string') {
    error(id, { code: PROTOCOL_ERROR.INVALID_REQUEST, message: 'Invalid Request: missing method.' });
    return;
  }

  switch (method) {
    case 'initialize':
      handleInitialize(id, params);
      return;
    case 'ping':
      result(id, {});
      return;
    case 'tools/list':
      await handleToolsList(id);
      return;
    case 'tools/call':
      await handleToolsCall(id, params);
      return;
    default:
      if (method.startsWith('notifications/')) return; // fire-and-forget
      error(id, { code: PROTOCOL_ERROR.METHOD_NOT_FOUND, message: `Method not found: ${method}` });
  }
}

function run(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: PROTOCOL_ERROR.PARSE, message: 'Parse error: request is not valid JSON.' },
      });
      return;
    }
    if (request.jsonrpc !== '2.0') {
      error(request.id, {
        code: PROTOCOL_ERROR.INVALID_REQUEST,
        message: 'Invalid Request: "jsonrpc" must be "2.0".',
      });
      return;
    }
    handleRequest(request).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      error(request.id, { code: PROTOCOL_ERROR.INTERNAL, message: `Internal error: ${message}` });
    });
  });

  const shutdown = (): void => {
    rl.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

run();
