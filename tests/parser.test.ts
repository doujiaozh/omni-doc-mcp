/**
 * Omni-Doc-MCP — parser test suite (Node.js built-in test runner).
 *
 * Verifies the full parse chain against real, code-generated documents:
 * PDF (hand-rolled writer) → pdfjs-dist, DOCX (hand-rolled OOXML zip) →
 * mammoth → our HTML→Markdown compiler, XLSX → SheetJS, CSV → SheetJS.
 *
 * Run:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSupportedFormats, parseDocument } from '../src/doc_parsers/index.js';
import { UnsupportedFormatError } from '../src/doc_parsers/index.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures');
const fixture = (name: string): string => join(fixturesDir, name);

test('fixtures were generated before the suite runs', () => {
  for (const name of ['test.pdf', 'test.docx', 'test.xlsx', 'test.csv']) {
    assert.equal(existsSync(fixture(name)), true, `missing fixture: ${name}`);
  }
});

test('PDF: extracts text page by page as Markdown', async () => {
  const result = await parseDocument(fixture('test.pdf'));

  assert.equal(result.format, 'pdf');
  assert.equal(result.meta.numPages, 2);
  assert.equal(result.meta.parsedPages, 2);

  assert.match(result.markdown, /## Page 1/);
  assert.match(result.markdown, /## Page 2/);
  assert.match(result.markdown, /Hello, World! This is page one\./);
  assert.match(result.markdown, /The quick brown fox jumps over the lazy dog\./);

  const json = result.json as { pages: Array<{ pageNumber: number; text: string }> };
  assert.equal(json.pages.length, 2);
  assert.equal(json.pages[0].pageNumber, 1);
  assert.match(json.pages[0].text, /Hello, World!/);
});

test('PDF: honors maxPages option', async () => {
  const result = await parseDocument(fixture('test.pdf'), { maxPages: 1 });
  assert.equal(result.meta.numPages, 2);
  assert.equal(result.meta.parsedPages, 1);
  assert.match(result.markdown, /## Page 1/);
  assert.doesNotMatch(result.markdown, /## Page 2/);
});

test('Word: docx → HTML → Markdown with heading and inline emphasis', async () => {
  const result = await parseDocument(fixture('test.docx'));

  assert.equal(result.format, 'docx');
  assert.match(result.markdown, /#\s+Omni-Doc-MCP Test Heading/);
  assert.match(result.markdown, /\*\*bold\*\*/);
  assert.match(result.markdown, /\*italic\*/);
  assert.match(result.markdown, /Second paragraph with more plain text\./);

  const json = result.json as { html: string };
  assert.match(json.html, /<h1>/);
  assert.match(json.html, /<strong>/);
});

test('Excel: sheets become Markdown tables', async () => {
  const result = await parseDocument(fixture('test.xlsx'));

  assert.equal(result.format, 'xlsx');
  assert.equal(result.meta.sheetCount, 2);

  assert.match(result.markdown, /## Sheet: Scores/);
  assert.match(result.markdown, /\| Name \| Score \| Note \|/);
  assert.match(result.markdown, /\| Alpha \| 95 \| excellent \|/);
  assert.match(result.markdown, /\| Gamma \| 72 \| ok \|/);
  assert.match(result.markdown, /## Sheet: Calc/);

  const json = result.json as { sheets: Array<{ name: string; rows: unknown[][] }> };
  assert.equal(json.sheets.length, 2);
  assert.deepEqual(json.sheets[0].rows[0], ['Name', 'Score', 'Note']);
});

test('CSV: parsed through the spreadsheet engine', async () => {
  const result = await parseDocument(fixture('test.csv'));

  assert.equal(result.format, 'csv');
  assert.match(result.markdown, /\| name \| city \| zip \|/);
  assert.match(result.markdown, /\| Alpha \| Beijing \| 100000 \|/);
});

test('unsupported extensions raise UnsupportedFormatError', async () => {
  await assert.rejects(
    () => parseDocument(fixture('missing.txt')),
    (error: unknown) => error instanceof UnsupportedFormatError,
  );
});

test('unsupported extension message mentions what is supported', async () => {
  await assert.rejects(
    () => parseDocument('no-extension-file'),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedFormatError);
      assert.match((error as Error).message, /pdf/);
      return true;
    },
  );
});

test('missing files surface a clear parse error', async () => {
  await assert.rejects(() => parseDocument(fixture('does-not-exist.pdf')), /Failed to parse PDF/);
});

test('listSupportedFormats advertises the core trio', () => {
  const formats = listSupportedFormats();
  const extensions = formats.map((f) => f.extension);

  assert.ok(extensions.includes('pdf'));
  assert.ok(extensions.includes('docx'));
  assert.ok(extensions.includes('xlsx'));
  for (const format of formats) {
    assert.ok(format.description.length > 0);
    assert.ok(format.mimeTypes.length > 0);
  }
});

test('outputFormat json returns structured data alongside markdown', async () => {
  const result = await parseDocument(fixture('test.xlsx'), { outputFormat: 'json' });
  assert.equal(typeof result.markdown, 'string');
  assert.ok(result.markdown.length > 0);
  assert.ok(result.json !== null && typeof result.json === 'object');
});
