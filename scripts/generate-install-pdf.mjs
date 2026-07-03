// Генерира install.pdf от README.md, запазвайки структурата и стила.
// Употреба: node scripts/generate-install-pdf.mjs
//
// Изисквания:
//   - Node.js
//   - пакет "marked"  (npm install marked)
//   - инсталиран Google Chrome или Microsoft Edge (за печат към PDF)

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(root, "README.md");
const htmlPath = join(root, "install.html");
const pdfPath = join(root, "install.pdf");

const md = readFileSync(readmePath, "utf8");
const body = marked.parse(md, { gfm: true, breaks: false });

const html = `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="utf-8">
<title>Инсталация — Банка ДСК покупки на Кредит</title>
<style>
  :root {
    --dsk: #005b9f;
    --dsk-dark: #003f6e;
    --text: #1f2933;
    --muted: #52606d;
    --border: #d9e2ec;
    --code-bg: #f5f7fa;
    --note-bg: #eef5fb;
  }
  @page {
    size: A4;
    margin: 18mm 16mm 20mm 16mm;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: var(--text);
    font-size: 11pt;
    line-height: 1.55;
    margin: 0;
  }
  h1, h2, h3, h4 {
    color: var(--dsk-dark);
    line-height: 1.25;
    page-break-after: avoid;
  }
  h1 {
    font-size: 20pt;
    margin: 0 0 4px;
    padding-bottom: 10px;
    border-bottom: 3px solid var(--dsk);
  }
  h2 {
    font-size: 15pt;
    margin: 22px 0 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  h3 { font-size: 12.5pt; margin: 16px 0 6px; }
  h4 { font-size: 11pt; margin: 12px 0 4px; color: var(--dsk); }
  p { margin: 6px 0; }
  a { color: var(--dsk); text-decoration: none; }
  strong { color: var(--dsk-dark); }
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 18px 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
    font-size: 10pt;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }
  th { background: var(--dsk); color: #fff; font-weight: 600; }
  tr:nth-child(even) td { background: #f7fafc; }
  code {
    font-family: "Consolas", "Courier New", monospace;
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 9.5pt;
    color: #b02a37;
  }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-left: 3px solid var(--dsk);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    page-break-inside: avoid;
  }
  pre code {
    background: none;
    padding: 0;
    color: var(--text);
  }
  blockquote {
    margin: 10px 0;
    padding: 8px 14px;
    background: var(--note-bg);
    border-left: 4px solid var(--dsk);
    border-radius: 4px;
    color: var(--muted);
  }
  blockquote p { margin: 0; }
  .doc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .doc-badge {
    font-size: 9pt;
    color: #fff;
    background: var(--dsk);
    padding: 4px 10px;
    border-radius: 20px;
    white-space: nowrap;
  }
</style>
</head>
<body>
<div class="doc-header">
  <span class="doc-badge">Помощен файл за инсталация</span>
</div>
${body}
</body>
</html>`;

writeFileSync(htmlPath, html, "utf8");

const candidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browser = candidates.find((p) => existsSync(p));

if (!browser) {
  console.error("Не е намерен Chrome или Edge за генериране на PDF.");
  console.error("HTML файлът е наличен на: " + htmlPath);
  process.exit(1);
}

const result = spawnSync(
  browser,
  [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    htmlPath,
  ],
  { stdio: "inherit" },
);

if (result.status !== 0 || !existsSync(pdfPath)) {
  console.error("Генерирането на PDF се провали.");
  process.exit(1);
}

rmSync(htmlPath, { force: true });
console.log("Готово: " + pdfPath);
