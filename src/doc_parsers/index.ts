/**
 * Omni-Doc-MCP — the unified document parsing entry point.
 *
 * `parseDocument(filePath)` is the single API every consumer (MCP server, CLI,
 * web demo) talks to. Parsers register by file extension, so adding a new
 * format is a matter of implementing `DocumentParser` and appending it to the
 * `parsers` array.
 */

import { extname } from 'node:path';
import { ExcelParser } from './excel.parser.js';
import { PdfParser } from './pdf.parser.js';
import { WordParser } from './word.parser.js';
import { UnsupportedFormatError } from './types.js';
import type { DocumentParser, FormatInfo, ParseResult, ParserOptions } from './types.js';

export const FORMAT_INFO: readonly FormatInfo[] = [
  {
    extension: 'pdf',
    mimeTypes: ['application/pdf'],
    description: 'PDF documents — text extracted page by page via pdfjs-dist (pure JS/WASM).',
  },
  {
    extension: 'docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    description: 'Microsoft Word 2007+ documents — docx → HTML → Markdown via mammoth (pure JS).',
  },
  {
    extension: 'xlsx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    description: 'Microsoft Excel 2007+ workbooks — sheets → Markdown tables via SheetJS (pure JS).',
  },
  {
    extension: 'xls',
    mimeTypes: ['application/vnd.ms-excel'],
    description: 'Legacy Microsoft Excel 97-2003 workbooks via SheetJS (pure JS).',
  },
  {
    extension: 'csv',
    mimeTypes: ['text/csv'],
    description: 'Comma-separated values — rendered as a Markdown table via SheetJS (pure JS).',
  },
];

const parsers: DocumentParser[] = [new PdfParser(), new WordParser(), new ExcelParser()];

const extensionMap = new Map<string, DocumentParser>();
for (const parser of parsers) {
  for (const extension of parser.extensions) extensionMap.set(extension, parser);
}

/**
 * Parse any supported local document into LLM-friendly Markdown.
 *
 * @example
 * ```ts
 * const result = await parseDocument('./report.pdf');
 * console.log(result.markdown);
 * ```
 *
 * @throws {UnsupportedFormatError} if the file extension has no parser.
 */
export async function parseDocument(filePath: string, options: ParserOptions = {}): Promise<ParseResult> {
  const extension = extname(filePath).slice(1).toLowerCase();
  const parser = extensionMap.get(extension);
  if (!parser) {
    throw new UnsupportedFormatError(extension || '(none)', FORMAT_INFO.map((f) => f.extension));
  }
  return parser.parse(filePath, options);
}

/** List every format the engine currently understands. */
export function listSupportedFormats(): FormatInfo[] {
  return FORMAT_INFO.map((f) => ({ ...f }));
}

export { PdfParser } from './pdf.parser.js';
export { WordParser } from './word.parser.js';
export { ExcelParser } from './excel.parser.js';
export { htmlToMarkdown } from './html-to-markdown.js';
export type {
  DocumentParser,
  FormatInfo,
  ParseResult,
  ParserOptions,
  SupportedExtension,
} from './types.js';
export { DocumentParseError, UnsupportedFormatError } from './types.js';
