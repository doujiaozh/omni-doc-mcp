/**
 * Omni-Doc-MCP — test fixture generator.
 *
 * Generates the three sample documents used by the test suite — with zero
 * generator dependencies:
 *
 *   - test.pdf  : hand-rolled PDF writer (we emit the objects, the xref table
 *                 and the trailer ourselves — the file is a valid PDF 1.7
 *                 document with uncompressed text streams).
 *   - test.docx : hand-rolled ZIP (STORED, no compression) writer wrapping a
 *                 minimal Office Open XML package (mammoth only needs the
 *                 content types, the package rels and word/document.xml).
 *   - test.xlsx : written with SheetJS (already a runtime dependency).
 *   - test.csv  : plain text.
 *
 * Run:  npm run gen-fixtures   (or automatically as part of `npm test`)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures');

/* ------------------------------------------------------------------ *
 * CRC32 (table driven) — needed for ZIP checksums.
 * ------------------------------------------------------------------ */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Minimal ZIP writer (method 0 = STORED, so no DEFLATE needed).
 * ------------------------------------------------------------------ */
function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function zipStored(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localBytes: number[] = [];
  const centralBytes: number[] = [];
  let offset = 0;

  // DOS timestamp: 2026-11-01 00:00:00
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (11 << 5) | 1;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 bytes + name)
    localBytes.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0));
    localBytes.push(...u16(dosTime), ...u16(dosDate));
    localBytes.push(...u32(crc), ...u32(size), ...u32(size));
    localBytes.push(...u16(name.length), ...u16(0));
    localBytes.push(...name);
    for (let i = 0; i < size; i++) localBytes.push(entry.data[i]);

    // Central directory record (46 bytes + name)
    centralBytes.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0));
    centralBytes.push(...u16(dosTime), ...u16(dosDate));
    centralBytes.push(...u32(crc), ...u32(size), ...u32(size));
    centralBytes.push(...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0));
    centralBytes.push(...u32(0), ...u32(offset));
    centralBytes.push(...name);

    offset += 30 + name.length + size;
  }

  const centralOffset = offset;
  const centralSize = centralBytes.length;

  // End of central directory record (22 bytes)
  const eocd: number[] = [
    ...u32(0x06054b50),
    ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(centralOffset),
    ...u16(0),
  ];

  return Uint8Array.from([...localBytes, ...centralBytes, ...eocd]);
}

/* ------------------------------------------------------------------ *
 * Minimal PDF writer (PDF 1.7, uncompressed, base-14 Helvetica).
 * ------------------------------------------------------------------ */
function escapePdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(pages: string[][]): Uint8Array {
  const encoder = new TextEncoder();

  // Object 1: catalog, 2: pages, then per page: page object + content stream.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ];
  pages.forEach((lines, pageIndex) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${pages.length * 2 + 3} 0 R >> >> ` +
        `/Contents ${4 + pageIndex * 2} 0 R >>`,
    );
    const ops = lines
      .map((line, lineIndex) => `BT /F1 18 Tf 60 ${720 - lineIndex * 28} Td (${escapePdfString(line)}) Tj ET`)
      .join('\n');
    objects.push(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encoder.encode(pdf);
}

/* ------------------------------------------------------------------ *
 * Minimal DOCX (Office Open XML) package.
 * ------------------------------------------------------------------ */
function buildDocx(): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Omni-Doc-MCP Test Heading</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">This is a </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r><w:r><w:t xml:space="preserve"> test paragraph.</w:t></w:r></w:p>
<w:p><w:r><w:t>Second paragraph with more plain text.</w:t></w:r></w:p>
</w:body>
</w:document>`;

  const encoder = new TextEncoder();
  return zipStored([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rels) },
    { name: 'word/document.xml', data: encoder.encode(document) },
  ]);
}

/* ------------------------------------------------------------------ *
 * XLSX (SheetJS) and CSV.
 * ------------------------------------------------------------------ */
function buildXlsx(): Uint8Array {
  const scores = XLSX.utils.aoa_to_sheet([
    ['Name', 'Score', 'Note'],
    ['Alpha', 95, 'excellent'],
    ['Beta', 88, 'good'],
    ['Gamma', 72, 'ok'],
  ]);
  const calc = XLSX.utils.aoa_to_sheet([
    ['A', 'B'],
    [1, 2],
    [3, 4],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, scores, 'Scores');
  XLSX.utils.book_append_sheet(workbook, calc, 'Calc');
  const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: false });
  return Uint8Array.from(Buffer.from(output as ArrayBuffer));
}

async function main(): Promise<void> {
  await mkdir(fixturesDir, { recursive: true });

  const pdf = buildPdf([
    ['Omni-Doc-MCP PDF Test', 'Hello, World! This is page one.'],
    ['Second page heading', 'The quick brown fox jumps over the lazy dog.'],
  ]);
  await writeFile(join(fixturesDir, 'test.pdf'), pdf);

  await writeFile(join(fixturesDir, 'test.docx'), buildDocx());
  await writeFile(join(fixturesDir, 'test.xlsx'), buildXlsx());

  const csv = 'name,city,zip\nAlpha,Beijing,100000\nBeta,Shanghai,200000\n';
  await writeFile(join(fixturesDir, 'test.csv'), csv, 'utf8');

  console.log(`Fixtures written to ${fixturesDir}`);
  console.log('  - test.pdf  (hand-rolled PDF writer)');
  console.log('  - test.docx (hand-rolled ZIP/OOXML writer)');
  console.log('  - test.xlsx (SheetJS)');
  console.log('  - test.csv  (plain text)');
}

main().catch((error: unknown) => {
  console.error('Failed to generate fixtures:', error);
  process.exitCode = 1;
});
