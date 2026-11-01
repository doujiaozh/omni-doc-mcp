# Omni-Doc-MCP

> **Omni-Doc-MCP：无需 Java，无需 Python，让 AI 在你的浏览器里直接读懂万物。**
>
> *Omni-Doc-MCP: no Java, no Python — let AI read everything, right in your browser.*

A universal document parsing hub for AI agents. Extract text and structure from **PDF, Word (.docx) and Excel (.xlsx / .xls / .csv)** and convert them to LLM-friendly **Markdown** — exposed through a standard **MCP (Model Context Protocol)** server, a CLI, and a drag-and-drop web demo.

100% pure **Node.js + TypeScript**. Zero native C++ compilation, zero JVM, zero Python runtime. Runs anywhere Node 18+ runs — including a stock Windows 7 box.

---

## English

### Why not Apache Tika?

Tika is the heavyweight champion of document parsing — but it drags a JVM along everywhere it goes. On memory-constrained or legacy hosts (think 8 GB Windows 7 machines), provisioning Java just to read a spreadsheet is a non-starter.

Omni-Doc-MCP takes the pure-JavaScript route:

| Concern | Tika | Omni-Doc-MCP |
| --- | --- | --- |
| Runtime | JVM (~200 MB+) | Node.js (already on your machine) |
| Native builds | JNI bindings in some parsers | None — pure JS / WASM |
| Output for AI | Raw text / XHTML | LLM-friendly Markdown + JSON |
| Agent integration | DIY | Stdio MCP server out of the box |

The parsing engines are battle-tested open-source pure-JS libraries:
- **PDF** → [pdfjs-dist](https://github.com/mozilla/pdf.js) (Mozilla's PDF engine, the same one inside Firefox)
- **Word (.docx)** → [mammoth](https://github.com/mwilliamson/mammoth) (docx → clean HTML), compiled to Markdown by our own zero-dependency HTML→Markdown converter
- **Excel (.xlsx/.xls/.csv)** → [SheetJS](https://github.com/SheetJS/sheetjs) (xlsx)

(*"Zero-dependency"* here means: no JVM, no Python, no native C++ compilation — nothing that needs a toolchain beyond `npm install`. The three runtime libraries above are pure JavaScript.)

### Project layout

```
omni-doc-mcp/
├── bin/omni-doc.js              # CLI launcher (boots the compiled TS)
├── src/
│   ├── bin/omni-doc.ts          # CLI: parse / --formats / --serve
│   ├── doc_parsers/             # The pure-JS document engines
│   │   ├── types.ts             # Shared contracts (Parser, ParseResult, errors)
│   │   ├── pdf.parser.ts        # pdfjs-dist, page-by-page text + line rebuild
│   │   ├── word.parser.ts       # mammoth docx → HTML → Markdown
│   │   ├── excel.parser.ts      # SheetJS sheets → Markdown tables / JSON
│   │   ├── html-to-markdown.ts  # Hand-rolled, zero-dep HTML → Markdown
│   │   └── index.ts             # parseDocument() registry + listSupportedFormats()
│   └── mcp_server/server.ts     # Hand-rolled stdio MCP (JSON-RPC 2.0)
├── demo/index.html              # Single-file drag-and-drop web demo
├── tests/
│   ├── generate-fixtures.ts     # Code-generates a real PDF, DOCX, XLSX, CSV
│   ├── parser.test.ts           # Parse-chain suite (Node test runner)
│   └── mcp-probe.ts             # Manual MCP protocol smoke probe
└── package.json
```

### Quick start

```bash
git clone https://github.com/<your-user>/omni-doc-mcp.git
cd omni-doc-mcp
npm install          # pure-JS deps only — no native build step
npm run build        # tsc → dist/
npm test             # builds, generates fixtures, runs the suite (11 tests)
```

### CLI

```bash
node bin/omni-doc.js ./test.pdf                    # print extracted Markdown
node bin/omni-doc.js ./sheet.xlsx --format json    # structured JSON output
node bin/omni-doc.js ./big.pdf --max-pages 5       # cap PDF pagination
node bin/omni-doc.js --formats                     # list supported formats
node bin/omni-doc.js --serve --port 4321           # launch the web demo
```

### Web demo

```bash
npm run demo        # → http://127.0.0.1:4321
```

Drag a PDF / DOCX / XLSX onto the page (or click to browse). The file is posted to the local server, parsed in-process, and previewed as rendered Markdown — with a raw-Markdown source tab. Nothing leaves your machine.

### MCP server (for AI agents)

```bash
npm run mcp         # stdio JSON-RPC 2.0 server
```

Tools exposed:

| Tool | Arguments | Returns |
| --- | --- | --- |
| `read_document` | `filePath`, optional `outputFormat` (`markdown`\|`json`), optional `maxPages` | Extracted Markdown or `{ format, json, meta }` |
| `list_supported_formats` | — | Advertised extensions, MIME types, descriptions |

Mount it on an MCP client, e.g. Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "omni-doc-mcp": {
      "command": "node",
      "args": ["D:/Code/omni-doc-mcp/dist/src/mcp_server/server.js"]
    }
  }
}
```

The server implements the MCP stdio transport by hand (newline-delimited JSON-RPC 2.0): `initialize` with protocol-version negotiation, `tools/list`, `tools/call`, graceful `notifications/*` handling, and standard error codes (`-32700`, `-32600`, `-32601`, `-32602`, `-32603`). Parse failures inside a tool come back as `isError` tool results so the agent can react, instead of crashing the transport.

### Programmatic use

```ts
import { parseDocument, listSupportedFormats } from 'omni-doc-mcp';

const result = await parseDocument('./report.pdf', { outputFormat: 'markdown', maxPages: 10 });
console.log(result.markdown);   // "## Page 1\n\n..."
console.log(result.meta);       // { format: 'pdf', numPages: 12, parsedPages: 10 }
```

### Notes & limitations

- The `@napi-rs/canvas` / `DOMMatrix` warnings you may see on stderr come from pdfjs-dist probing for an optional canvas renderer. Text extraction does not use it; the warnings are harmless.
- Old binary `.doc` (Word 97-2003) is out of scope for the pure-JS stack — convert to `.docx` first.
- Scanned PDFs without a text layer yield no text (no OCR on purpose — that would need a native runtime).

## 中文

### 为什么不用 Apache Tika？

Tika 是文档解析领域的王者，但它随身拖着一个 JVM。在内存紧张的老机器上（比如 8G 内存的 Win7），为了读一张表格而装一套 Java 环境并不划算。

Omni-Doc-MCP 走纯 JS 路线：解析引擎全部是久经考验的开源纯 JavaScript 库（pdfjs-dist / mammoth / SheetJS），我们自己实现 HTML→Markdown 转换与 MCP 协议层，不引入任何 JNI、WASM 之外的二进制依赖，也不需要 C++ 编译工具链。

### 快速开始

```bash
git clone https://github.com/<your-user>/omni-doc-mcp.git
cd omni-doc-mcp
npm install          # 仅纯 JS 依赖，无原生编译
npm run build        # tsc → dist/
npm test             # 构建 → 生成测试文件 → 跑测试（11 项全绿）
```

### 命令行

```bash
node bin/omni-doc.js ./test.pdf                    # 输出 Markdown
node bin/omni-doc.js ./sheet.xlsx --format json    # 结构化 JSON
node bin/omni-doc.js ./big.pdf --max-pages 5       # 限制 PDF 页数
node bin/omni-doc.js --formats                     # 支持格式列表
node bin/omni-doc.js --serve --port 4321           # 启动网页演示
```

### 网页演示

```bash
npm run demo        # → http://127.0.0.1:4321
```

把 PDF / DOCX / XLSX 文件拖进页面即可预览解析出的 Markdown，也能切到源码视图。文件只在本地解析，不上传任何远端。

### MCP 服务器（给 AI Agent 用）

```bash
npm run mcp         # stdio JSON-RPC 2.0 服务器
```

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `read_document` | `filePath`，可选 `outputFormat`（`markdown`\|`json`）、`maxPages` | 提取出的 Markdown 或 `{ format, json, meta }` |
| `list_supported_formats` | — | 支持的扩展名、MIME 类型与说明 |

在 Claude Desktop 等 MCP 客户端中挂载（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "omni-doc-mcp": {
      "command": "node",
      "args": ["D:/Code/omni-doc-mcp/dist/src/mcp_server/server.js"]
    }
  }
}
```

服务器手写了 MCP stdio 传输层（换行分隔的 JSON-RPC 2.0）：`initialize` 协议版本协商、`tools/list`、`tools/call`、静默处理 `notifications/*`、标准错误码（`-32700`/`-32600`/`-32601`/`-32602`/`-32603`）。工具内部解析失败以 `isError` 结果返回，让 Agent 自己决定如何应对，而不是搞崩传输层。

### 编程式调用

```ts
import { parseDocument } from 'omni-doc-mcp';

const result = await parseDocument('./report.pdf', { outputFormat: 'json', maxPages: 10 });
console.log(result.json);   // { format, numPages, parsedPages, pages: [...] }
```

### 说明与边界

- 终端里可能看到的 `@napi-rs/canvas` / `DOMMatrix` 警告来自 pdfjs-dist 对可选画布渲染器的探测，纯文本提取用不到它，可忽略。
- 旧版二进制 `.doc`（Word 97-2003）不在纯 JS 技术栈范围内，请先转成 `.docx`。
- 没有文字层的扫描件 PDF 提取不出文本（刻意不做 OCR——那需要原生运行时）。

### 参与贡献

欢迎 Issue 与 PR：新增解析器请实现 `src/doc_parsers/types.ts` 中的 `DocumentParser` 接口，并在 `src/doc_parsers/index.ts` 注册。

## License

MIT — see [LICENSE](./LICENSE).
