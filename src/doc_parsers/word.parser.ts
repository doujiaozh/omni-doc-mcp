/**
 * Omni-Doc-MCP — Word (.docx) parser.
 *
 * Strategy: mammoth (pure JavaScript, no Java, no LibreOffice) converts the
 * Office Open XML package to clean semantic HTML, then our own zero-dependency
 * `htmlToMarkdown` compiler turns that HTML into LLM-friendly Markdown.
 */

import mammoth from 'mammoth';
import type { DocumentParser, ParseResult, ParserOptions } from './types.js';
import { DocumentParseError } from './types.js';
import { htmlToMarkdown } from './html-to-markdown.js';

export class WordParser implements DocumentParser {
  public readonly name = 'docx';
  public readonly extensions = ['docx'];

  public async parse(filePath: string, options: ParserOptions = {}): Promise<ParseResult> {
    try {
      const htmlResult = await mammoth.convertToHtml({ path: filePath });
      const markdown = htmlToMarkdown(htmlResult.value);
      const messages = htmlResult.messages.map((m) => ({ type: m.type, message: m.message }));

      if (options.outputFormat === 'json') {
        return {
          format: 'docx',
          markdown,
          json: { html: htmlResult.value, markdown, messages },
          meta: {
            format: 'docx',
            file: filePath,
            htmlLength: htmlResult.value.length,
            markdownLength: markdown.length,
            messages,
          },
        };
      }

      return {
        format: 'docx',
        markdown,
        json: { html: htmlResult.value, messages },
        meta: {
          format: 'docx',
          file: filePath,
          htmlLength: htmlResult.value.length,
          markdownLength: markdown.length,
          messages,
        },
      };
    } catch (error) {
      throw new DocumentParseError(
        `Failed to parse Word document "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}
