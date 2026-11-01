/**
 * Omni-Doc-MCP — PDF parser.
 *
 * Strategy: `pdfjs-dist` (Mozilla's pure JavaScript/WASM PDF engine — the same
 * engine that powers Firefox's built-in viewer) extracts text page by page.
 * No Java, no poppler, no native compilation. Line structure is reconstructed
 * from the text-item baselines and horizontal gaps so the output stays
 * readable for humans and LLMs alike.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import type { DocumentParser, ParseResult, ParserOptions } from './types.js';
import { DocumentParseError } from './types.js';

// The "legacy" build is the Node-friendly entry point of pdfjs-dist v4.
// @ts-ignore - types ship adjacent to the .mjs entry (pdf.d.mts); the ignore
// keeps compilation resilient across pdfjs-dist versions.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const nodeRequire = createRequire(import.meta.url);

/**
 * Resolve an asset directory shipped inside the pdfjs-dist package, so text
 * extraction keeps working for non-embedded standard-14 fonts (Helvetica,
 * Times, …) and for CJK/ CID-encoded PDFs — with zero downloads at runtime.
 * Returns an empty string when the package layout is unexpected, in which
 * case pdfjs simply falls back to built-in behavior.
 */
function resolvePdfjsAssetDir(dir: 'standard_fonts' | 'cmaps'): string {
  try {
    const pkgRoot = dirname(nodeRequire.resolve('pdfjs-dist/package.json'));
    return join(pkgRoot, dir);
  } catch {
    return '';
  }
}

const STANDARD_FONT_DATA_URL = resolvePdfjsAssetDir('standard_fonts');
const CMAP_URL = resolvePdfjsAssetDir('cmaps');

/** pdfjs text item subset we rely on. */
interface TextItem {
  str: string;
  hasEOL?: boolean;
  width?: number;
  transform?: number[];
}

/** Group text items into lines using baseline position and word gaps. */
function itemsToText(items: TextItem[]): string {
  const lines: string[] = [];
  let current = '';
  let prevBaseline: number | null = null;
  let prevEndX: number | null = null;

  const flush = (): void => {
    const line = current.trim();
    if (line) lines.push(line);
    current = '';
  };

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const transform = item.transform ?? [];
    const baseline = typeof transform[5] === 'number' ? transform[5] : null;
    const x = typeof transform[4] === 'number' ? transform[4] : null;
    const fontSize = typeof transform[3] === 'number' ? Math.abs(transform[3]) : 10;

    // A significant vertical jump means a new line.
    if (prevBaseline !== null && baseline !== null && Math.abs(baseline - prevBaseline) > 2.5) {
      flush();
      prevEndX = null;
    }

    // Insert a space when two adjacent items are visibly separated.
    if (
      prevEndX !== null && x !== null &&
      !current.endsWith(' ') && !item.str.startsWith(' ') &&
      x - prevEndX > 0.25 * fontSize
    ) {
      current += ' ';
    }

    current += item.str;
    if (item.hasEOL) {
      flush();
      prevEndX = null;
    } else if (x !== null) {
      prevEndX = item.width !== undefined ? x + item.width : x;
    }
    if (baseline !== null) prevBaseline = baseline;
  }
  flush();

  return lines.join('\n');
}

export class PdfParser implements DocumentParser {
  public readonly name = 'pdf';
  public readonly extensions = ['pdf'];

  public async parse(filePath: string, options: ParserOptions = {}): Promise<ParseResult> {
    const format = extname(filePath).slice(1).toLowerCase() || 'pdf';
    try {
      // Loading the file ourselves keeps pdfjs out of the fs layer and lets us
      // control buffering (important on memory-constrained hosts).
      const data = new Uint8Array(await readFile(filePath));

      const loadingTask = pdfjsLib.getDocument({
        data,
        disableFontFace: true,
        useSystemFonts: false,
        ...(STANDARD_FONT_DATA_URL ? { standardFontDataUrl: STANDARD_FONT_DATA_URL } : {}),
        ...(CMAP_URL ? { cMapUrl: CMAP_URL, cMapPacked: true } : {}),
      });

      const document = await loadingTask.promise;
      const numPages = document.numPages;
      const maxPages = options.maxPages && options.maxPages > 0 ? Math.min(options.maxPages, numPages) : numPages;

      const pages: Array<Record<string, unknown>> = [];
      const parts: string[] = [];

      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        try {
          const textContent = await page.getTextContent();
          const text = itemsToText(textContent.items as TextItem[]);
          pages.push({ pageNumber, text });
          parts.push(`## Page ${pageNumber}\n\n${text.trim() || '_(no extractable text on this page)_'}`);
        } finally {
          page.cleanup();
        }
      }

      await document.destroy();
      await loadingTask.destroy();

      const markdown = parts.join('\n\n').trim() + '\n';
      const json = { format, numPages, parsedPages: pages.length, pages };

      return {
        format,
        markdown,
        json,
        meta: {
          format,
          file: filePath,
          numPages,
          parsedPages: pages.length,
        },
      };
    } catch (error) {
      throw new DocumentParseError(
        `Failed to parse PDF "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}
