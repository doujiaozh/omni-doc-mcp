/**
 * Omni-Doc-MCP — minimal, dependency-free HTML → Markdown converter.
 *
 * Tuned for the semantic HTML emitted by mammoth (docx → html), but handles
 * general markup: headings, paragraphs, bold/italic/strike, links, images,
 * ordered/unordered (nested) lists, tables, blockquotes, code blocks and
 * horizontal rules. ~200 lines, zero dependencies, fully synchronous.
 */

interface HTextNode {
  kind: 'text';
  value: string;
}

interface HElementNode {
  kind: 'el';
  tag: string;
  attrs: Record<string, string>;
  children: HNode[];
}

type HNode = HTextNode | HElementNode;

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', deg: '°', plusmn: '±', times: '×', divide: '÷',
};

function decodeEntities(input: string): string {
  return input.replace(/&#(x?[0-9a-fA-F]+);|&([a-zA-Z]+);/g, (match, numeric?: string, named?: string) => {
    if (typeof numeric === 'string') {
      const isHex = numeric[0] === 'x' || numeric[0] === 'X';
      const code = parseInt(isHex ? numeric.slice(1) : numeric, isHex ? 16 : 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return named !== undefined && NAMED_ENTITIES[named] !== undefined ? NAMED_ENTITIES[named] : match;
  });
}

function parseAttributes(rawTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][a-zA-Z0-9:_.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawTag)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : (m[4] ?? '');
  }
  return attrs;
}

function parseHtml(html: string): HNode[] {
  const root: HNode[] = [];
  const stack: HNode[][] = [root];
  const tagRe = /<\/?([a-zA-Z][^\s/>]*)[^>]*?\/?>/g;
  const pushText = (text: string): void => {
    if (text.length > 0) stack[stack.length - 1].push({ kind: 'text', value: text });
  };
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (m.index > last) pushText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const raw = m[0];
    const tag = m[1].toLowerCase();
    if (raw.startsWith('</')) {
      // Closing tag — never pop the virtual root, tolerant to sloppy markup.
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el: HNode = { kind: 'el', tag, attrs: parseAttributes(raw), children: [] };
    stack[stack.length - 1].push(el);
    if (!raw.endsWith('/>') && !VOID_TAGS.has(tag)) stack.push(el.children);
  }
  if (last < html.length) pushText(html.slice(last));
  return root;
}

/** Render only inline content (text + inline tags), collapsing whitespace. */
function renderInline(nodes: HNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += decodeEntities(node.value);
      continue;
    }
    switch (node.tag) {
      case 'strong': case 'b': {
        const inner = renderInline(node.children).trim();
        out += inner ? `**${inner}**` : '';
        break;
      }
      case 'em': case 'i': case 'u': case 'cite': {
        const inner = renderInline(node.children).trim();
        out += inner ? `*${inner}*` : '';
        break;
      }
      case 's': case 'del': case 'strike': {
        const inner = renderInline(node.children).trim();
        out += inner ? `~~${inner}~~` : '';
        break;
      }
      case 'code':
        out += '`' + renderInline(node.children) + '`';
        break;
      case 'a': {
        const href = node.attrs.href ?? '';
        const text = renderInline(node.children).trim();
        out += href && text ? `[${text}](${href})` : text;
        break;
      }
      case 'img': {
        const alt = decodeEntities(node.attrs.alt ?? '');
        const src = node.attrs.src ?? '';
        out += src ? `![${alt}](${src})` : alt;
        break;
      }
      case 'br':
        out += '\n';
        break;
      default:
        out += renderInline(node.children);
    }
  }
  return out.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n');
}

function extractRawText(node: HNode): string {
  if (node.kind === 'text') return decodeEntities(node.value);
  return node.children.map(extractRawText).join('');
}

function renderList(node: HElementNode, ordered: boolean, depth: number): string {
  let out = '';
  let index = 0;
  for (const child of node.children) {
    if (child.kind !== 'el') continue;
    if (child.tag === 'li') {
      index++;
      const marker = ordered && depth === 0 ? `${index}. ` : '- ';
      const inlineParts: string[] = [];
      const nestedParts: string[] = [];
      for (const grand of child.children) {
        if (grand.kind === 'el' && (grand.tag === 'ul' || grand.tag === 'ol')) {
          nestedParts.push(renderList(grand, grand.tag === 'ol', depth + 1));
        } else {
          inlineParts.push(renderInline([grand]));
        }
      }
      const indent = '  '.repeat(depth);
      out += `${indent}${marker}${inlineParts.join('').trim()}\n${nestedParts.join('')}`;
    } else if (child.tag === 'ul' || child.tag === 'ol') {
      out += renderList(child, child.tag === 'ol', depth);
    }
  }
  return out + '\n';
}

function renderTable(node: HElementNode): string {
  const rows: string[][] = [];
  const collectRow = (tr: HElementNode): void => {
    const cells: string[] = [];
    for (const cell of tr.children) {
      if (cell.kind === 'el' && (cell.tag === 'td' || cell.tag === 'th')) {
        cells.push(
          renderInline(cell.children)
            .trim()
            .replace(/\|/g, '\\|')
            .replace(/\n/g, ' '),
        );
      }
    }
    if (cells.length) rows.push(cells);
  };
  const walk = (n: HElementNode): void => {
    for (const child of n.children) {
      if (child.kind !== 'el') continue;
      if (child.tag === 'tr') collectRow(child);
      else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot' || child.tag === 'table') {
        walk(child);
      }
    }
  };
  walk(node);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
  const header = normalized[0];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function quoteBlock(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function renderBlocks(nodes: HNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      const text = decodeEntities(node.value).replace(/\s+/g, ' ').trim();
      if (text) out += text + '\n\n';
      continue;
    }
    switch (node.tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = Number(node.tag[1]);
        const text = renderInline(node.children).trim();
        if (text) out += '#'.repeat(level) + ' ' + text + '\n\n';
        break;
      }
      case 'p': {
        const text = renderInline(node.children).trim();
        if (text) out += text + '\n\n';
        break;
      }
      case 'div': case 'section': case 'article': case 'main': case 'body': case 'header': case 'footer': {
        out += renderBlocks(node.children);
        break;
      }
      case 'ul': case 'ol':
        out += renderList(node, node.tag === 'ol', 0);
        break;
      case 'blockquote':
        out += quoteBlock(renderBlocks(node.children)) + '\n\n';
        break;
      case 'pre': {
        const code = extractRawText(node).replace(/\n{3,}/g, '\n\n').trim();
        out += '```\n' + code + '\n```\n\n';
        break;
      }
      case 'table': {
        const table = renderTable(node);
        if (table) out += table + '\n\n';
        break;
      }
      case 'hr':
        out += '---\n\n';
        break;
      case 'br':
        out += '\n';
        break;
      case 'img': {
        const img = renderInline([node]).trim();
        if (img) out += img + '\n\n';
        break;
      }
      default: {
        const text = renderInline([node]).trim();
        if (text) out += text + '\n\n';
      }
    }
  }
  return out;
}

/**
 * Convert an HTML fragment to clean, LLM-friendly Markdown.
 * Block-level structure is preserved; inline whitespace is collapsed.
 */
export function htmlToMarkdown(html: string): string {
  const markdown = renderBlocks(parseHtml(html));
  return markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}
