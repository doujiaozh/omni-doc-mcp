/**
 * Omni-Doc-MCP — Excel (.xlsx/.xls/.csv) parser.
 *
 * Strategy: SheetJS (`xlsx`, pure JavaScript) reads the workbook entirely in
 * memory. Every worksheet is converted to a row matrix and rendered both as a
 * clean Markdown table (default, LLM friendly) and as JSON.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import * as XLSX from 'xlsx';
import type { DocumentParser, ParseResult, ParserOptions } from './types.js';
import { DocumentParseError } from './types.js';

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function rowsToMarkdownTable(rows: unknown[][]): string {
  const matrix = rows
    .map((row) => (Array.isArray(row) ? row.map(cellToText) : [cellToText(row)]));

  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  if (matrix.length === 0 || width === 0) return '';

  const padded = matrix.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });

  const header = padded[0];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...padded.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

export class ExcelParser implements DocumentParser {
  public readonly name = 'xlsx';
  public readonly extensions = ['xlsx', 'xls', 'csv'];

  public async parse(filePath: string, options: ParserOptions = {}): Promise<ParseResult> {
    const format = extname(filePath).slice(1).toLowerCase() || 'xlsx';
    try {
      const buffer = await readFile(filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer', cellHTML: false, dense: false });

      const sheets: Array<Record<string, unknown>> = [];
      const parts: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;

        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
          header: 1,
          defval: '',
          blankrows: options.skipEmptySheets !== true,
          raw: false,
        });

        const table = rowsToMarkdownTable(rows);
        const ref = worksheet['!ref'] as string | undefined;
        const isEmpty = table.length === 0;

        sheets.push({
          name: sheetName,
          range: ref ?? null,
          rows,
          rowCount: rows.length,
          isEmpty,
        });

        if (options.skipEmptySheets && isEmpty) continue;
        parts.push(`## Sheet: ${sheetName}\n\n${isEmpty ? '_(empty sheet)_' : table}`);
      }

      const markdown = parts.join('\n\n').trim() + '\n';
      const json = {
        format,
        sheetCount: workbook.SheetNames.length,
        sheetNames: workbook.SheetNames.slice(),
        sheets,
      };

      return {
        format,
        markdown,
        json,
        meta: {
          format,
          file: filePath,
          sheetCount: workbook.SheetNames.length,
          sheetNames: workbook.SheetNames.slice(),
        },
      };
    } catch (error) {
      throw new DocumentParseError(
        `Failed to parse spreadsheet "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}
