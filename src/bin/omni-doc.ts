#!/usr/bin/env node
/**
 * Omni-Doc-MCP — command line interface.
 *
 *   omni-doc <file> [--format markdown|json] [--max-pages N]   parse & print
 *   omni-doc --formats                                         list formats
 *   omni-doc --serve [--port 4321]                             local web demo
 *   omni-doc --version / --help
 */

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSupportedFormats, parseDocument } from '../doc_parsers/index.js';

const VERSION = '1.0.0';
const DEFAULT_PORT = 4321;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB sanity cap

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printHelp(): void {
  console.log(`
  Omni-Doc-MCP ${VERSION} — zero-dependency universal document parser
  无需 Java，无需 Python — parse PDF / Word / Excel in pure Node.js

  USAGE / 用法
    omni-doc <file> [options]            Parse a document, print Markdown to stdout
    omni-doc --formats                   List supported formats
    omni-doc --serve [--port N]          Start the local web demo server
    omni-doc --version                   Print version
    omni-doc --help                      Show this help

  OPTIONS / 选项
    --format markdown|json               Output shape (default: markdown)
    --max-pages N                        PDF only: parse at most N pages (default: all)
    --port N                             Demo server port (default: ${DEFAULT_PORT})

  EXAMPLES / 示例
    omni-doc ./report.pdf
    omni-doc ./sheet.xlsx --format json
    omni-doc ./big.pdf --max-pages 5
    omni-doc --serve --port 8080
`);
}

function describeMeta(meta: Record<string, unknown>): string {
  if (typeof meta.numPages === 'number') return `${meta.numPages} page(s)`;
  if (typeof meta.sheetCount === 'number') return `${meta.sheetCount} sheet(s)`;
  return '';
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.help === true || flags.h === true) {
    printHelp();
    return;
  }
  if (flags.version === true || flags.v === true) {
    console.log(VERSION);
    return;
  }
  if (flags.formats !== undefined) {
    for (const info of listSupportedFormats()) {
      console.log(`  ${info.extension.padEnd(5)} ${info.mimeTypes.join(', ').padEnd(70)} ${info.description}`);
    }
    return;
  }
  if (flags.serve !== undefined) {
    const port = typeof flags.port === 'string' ? Number(flags.port) : DEFAULT_PORT;
    await startDemoServer(Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT);
    return;
  }

  const file = positional[0];
  if (!file) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const outputFormat = flags.format === 'json' || flags.json === true ? 'json' : 'markdown';
  const maxPages = typeof flags['max-pages'] === 'string' ? Number(flags['max-pages']) : 0;

  try {
    const result = await parseDocument(file, {
      outputFormat,
      ...(maxPages > 0 ? { maxPages } : {}),
    });
    if (outputFormat === 'json') {
      console.log(JSON.stringify({ format: result.format, json: result.json, meta: result.meta }, null, 2));
    } else {
      console.log(result.markdown);
    }
    const detail = describeMeta(result.meta);
    console.error(`✓ omni-doc-mcp: parsed ${file} (${result.format}${detail ? `, ${detail}` : ''})`);
  } catch (error) {
    console.error(`✗ omni-doc-mcp: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function startDemoServer(port: number): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const demoFile = join(root, 'demo', 'index.html');
  if (!existsSync(demoFile)) {
    console.error(`✗ omni-doc-mcp: demo page not found at ${demoFile} — run "npm run build" first.`);
    process.exitCode = 1;
    return;
  }
  const demoHtml = await readFile(demoFile, 'utf8');

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(demoHtml);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', service: 'omni-doc-mcp', version: VERSION }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/parse') {
      handleUpload(req, res).catch((error: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found — try GET / or POST /parse');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Omni-Doc-MCP web demo / 网页演示`);
    console.log(`  →  http://127.0.0.1:${port}\n`);
    console.log(`  Drag & drop a PDF / DOCX / XLSX file onto the page to preview its Markdown.`);
    console.log(`  Press Ctrl+C to stop.\n`);
  });
}

async function handleUpload(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  let received = 0;
  let tooLarge = false;

  await new Promise<void>((resolveStream, rejectStream) => {
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        tooLarge = true;
        req.destroy();
        resolveStream();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveStream());
    req.on('error', rejectStream);
  });

  if (tooLarge) {
    res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: `Upload exceeds the ${MAX_UPLOAD_BYTES} byte limit.` }));
    return;
  }

  const body = Buffer.concat(chunks);
  const rawName = (req.headers['x-filename'] as string | undefined) ?? 'upload.bin';
  const safeName = rawName.replace(/[\\/]/g, '_').slice(0, 200) || 'upload.bin';
  const tempPath = join(tmpdir(), `omni-doc-mcp-${randomUUID()}${extname(safeName)}`);

  try {
    await writeFile(tempPath, body);
    const result = await parseDocument(tempPath);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, result, fileName: safeName }));
  } catch (error) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      /* temp file may not exist — ignore */
    }
  }
}

main().catch((error: unknown) => {
  console.error(`✗ omni-doc-mcp: unexpected failure — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
