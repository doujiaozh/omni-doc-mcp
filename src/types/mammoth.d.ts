/**
 * Minimal ambient type declarations for `mammoth` (pure-JS .docx parser).
 * The package ships no TypeScript types of its own, so we declare exactly
 * the surface Omni-Doc-MCP relies on.
 */

declare module 'mammoth' {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface MammothInput {
    path?: string;
    buffer?: Buffer;
    arrayBuffer?: ArrayBuffer;
  }

  export type MammothOptions = Record<string, unknown>;

  export function convertToHtml(input: MammothInput, options?: MammothOptions): Promise<MammothResult>;

  export function extractRawText(input: MammothInput, options?: MammothOptions): Promise<MammothResult>;

  const mammoth: {
    convertToHtml: typeof convertToHtml;
    extractRawText: typeof extractRawText;
  };

  export default mammoth;
}
