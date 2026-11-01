#!/usr/bin/env node
/**
 * Omni-Doc-MCP CLI launcher.
 * Thin ESM shim that boots the compiled TypeScript entry in dist/.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '..', 'dist', 'src', 'bin', 'omni-doc.js');

if (!existsSync(entry)) {
  console.error('omni-doc-mcp: the project has not been built yet — run "npm run build" first.');
  process.exit(1);
}

await import(pathToFileURL(entry).href);
