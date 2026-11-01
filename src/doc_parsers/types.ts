/**
 * Omni-Doc-MCP — shared parser contracts.
 *
 * Every document parser implements the same `DocumentParser` interface so the
 * MCP layer, the CLI and the web demo can treat PDF / Word / Excel uniformly.
 */

export type SupportedExtension = 'pdf' | 'docx' | 'xlsx' | 'xls' | 'csv';

export interface FormatInfo {
  /** File extension without the leading dot, e.g. "pdf". */
  extension: string;
  /** Associated MIME types. */
  mimeTypes: string[];
  /** Human readable description (English). */
  description: string;
}

export interface ParserOptions {
  /** Output shape: "markdown" (default, LLM friendly) or "json". */
  outputFormat?: 'markdown' | 'json';
  /** PDF only: stop after this many pages (0 or undefined = parse all). */
  maxPages?: number;
  /** Excel only: skip sheets that are completely empty. */
  skipEmptySheets?: boolean;
}

export interface ParseResult {
  /** Detected source format, e.g. "pdf" | "docx" | "xlsx". */
  format: string;
  /** LLM-friendly Markdown representation of the document. */
  markdown: string;
  /** Structured (machine readable) view of the document. */
  json: unknown;
  /** Free-form metadata: page/sheet counts, warnings, etc. */
  meta: Record<string, unknown>;
}

export interface DocumentParser {
  /** Parser identifier, e.g. "pdf". */
  name: string;
  /** File extensions this parser accepts (lower case, no leading dot). */
  extensions: string[];
  /** Parse a local file into a {@link ParseResult}. */
  parse(filePath: string, options?: ParserOptions): Promise<ParseResult>;
}

/** Thrown when no registered parser can handle the given file extension. */
export class UnsupportedFormatError extends Error {
  public readonly extension: string;
  public readonly supported: string[];

  constructor(extension: string, supported: string[]) {
    super(
      `Unsupported document format ".${extension}". Supported: ${supported
        .map((e) => `.${e}`)
        .join(', ')}`,
    );
    this.name = 'UnsupportedFormatError';
    this.extension = extension;
    this.supported = supported;
  }
}

/** Thrown when the underlying pure-JS parser fails to read the file. */
export class DocumentParseError extends Error {
  public readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DocumentParseError';
    this.cause = cause;
  }
}
