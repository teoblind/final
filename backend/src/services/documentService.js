/**
 * Document Service — Generate DOCX and PDF files from markdown content.
 *
 * Converts markdown (headings, bold, italic, lists, paragraphs) to
 * formatted DOCX using the `docx` npm package. PDF generation uses
 * Chrome headless print-to-pdf when available.
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, TableRow, TableCell, Table, WidthType } from 'docx';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '../../data/generated-docs');

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Parse markdown text into structured paragraphs for DOCX generation.
 */
function parseMarkdown(markdown) {
  const lines = markdown.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push({ type: 'hr' });
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      elements.push({ type: 'heading', level, text: headingMatch[2] });
      i++;
      continue;
    }

    // List items
    const listMatch = line.match(/^(\s*)([-*]|\d+[.)]) (.+)/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      elements.push({ type: 'list', ordered, text: listMatch[3], indent: listMatch[1].length });
      i++;
      continue;
    }

    // Regular paragraph
    elements.push({ type: 'paragraph', text: line.trim() });
    i++;
  }

  return elements;
}

/**
 * Convert inline markdown (bold, italic) to TextRun objects.
 */
function parseInlineMarkdown(text) {
  const runs = [];
  // Match **bold**, *italic*, and plain text
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // Bold
      runs.push(new TextRun({ text: match[2], bold: true, font: 'Calibri', size: 22 }));
    } else if (match[3]) {
      // Italic
      runs.push(new TextRun({ text: match[3], italics: true, font: 'Calibri', size: 22 }));
    } else if (match[4]) {
      // Plain
      runs.push(new TextRun({ text: match[4], font: 'Calibri', size: 22 }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text, font: 'Calibri', size: 22 })];
}

/**
 * Convert parsed elements to DOCX paragraphs.
 */
function elementsToDocxParagraphs(elements) {
  const paragraphs = [];
  const NAVY = '1e3a5f';

  for (const el of elements) {
    switch (el.type) {
      case 'heading': {
        const headingLevel = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
        }[el.level] || HeadingLevel.HEADING_4;

        paragraphs.push(new Paragraph({
          children: [new TextRun({
            text: el.text.replace(/\*\*/g, ''),
            bold: true,
            font: 'Calibri',
            size: el.level === 1 ? 32 : el.level === 2 ? 26 : 24,
            color: NAVY,
          })],
          heading: headingLevel,
          spacing: { before: el.level <= 2 ? 360 : 240, after: 120 },
        }));
        break;
      }
      case 'paragraph': {
        paragraphs.push(new Paragraph({
          children: parseInlineMarkdown(el.text),
          spacing: { after: 120, line: 276 },
        }));
        break;
      }
      case 'list': {
        const bullet = el.ordered ? `  ` : '  ';
        paragraphs.push(new Paragraph({
          children: parseInlineMarkdown(el.text),
          bullet: el.ordered ? undefined : { level: 0 },
          numbering: el.ordered ? { reference: 'default-numbering', level: 0 } : undefined,
          spacing: { after: 60, line: 276 },
          indent: { left: 720 },
        }));
        break;
      }
      case 'hr': {
        paragraphs.push(new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } },
          spacing: { before: 240, after: 240 },
        }));
        break;
      }
    }
  }

  return paragraphs;
}

/**
 * Generate a DOCX file from markdown content.
 * @param {{ title: string, content: string, filename?: string }} params
 * @returns {{ filePath: string, filename: string, contentType: string }}
 */
export async function generateDocx({ title, content, filename }) {
  const elements = parseMarkdown(content);
  const paragraphs = elementsToDocxParagraphs(elements);

  const doc = new Document({
    creator: 'Coppice AI',
    title,
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: paragraphs,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const safeName = (filename || title).replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
  const outputFilename = `${safeName}.docx`;
  const filePath = join(OUTPUT_DIR, outputFilename);
  writeFileSync(filePath, buffer);

  return {
    filePath,
    filename: outputFilename,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

/**
 * Generate a PDF file from markdown content via Chrome headless.
 * Falls back to DOCX if Chrome is not available.
 * @param {{ title: string, content: string, filename?: string }} params
 * @returns {{ filePath: string, filename: string, contentType: string }}
 */
export async function generatePdf({ title, content, filename }) {
  const safeName = (filename || title).replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');

  // Convert markdown to styled HTML
  const html = markdownToStyledHtml(title, content);
  const htmlPath = join(OUTPUT_DIR, `${safeName}_temp.html`);
  const pdfPath = join(OUTPUT_DIR, `${safeName}.pdf`);
  writeFileSync(htmlPath, html);

  // Try Chrome headless
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];

  let chromeFound = false;
  for (const chromePath of chromePaths) {
    try {
      execSync(`"${chromePath}" --headless=new --no-sandbox --disable-gpu --print-to-pdf="${pdfPath}" --no-pdf-header-footer "file://${htmlPath}"`, {
        timeout: 30000,
        stdio: 'pipe',
      });
      chromeFound = true;
      break;
    } catch {
      continue;
    }
  }

  // Clean up temp HTML
  try { require('fs').unlinkSync(htmlPath); } catch {}

  if (chromeFound) {
    return {
      filePath: pdfPath,
      filename: `${safeName}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // Fallback to DOCX
  console.warn('[DocumentService] Chrome not found, falling back to DOCX');
  return generateDocx({ title, content, filename });
}

/**
 * Convert markdown to styled HTML for PDF generation.
 */
function markdownToStyledHtml(title, markdown) {
  let html = markdown
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, (match) => {
      if (match.includes('<li>')) return `<ul>${match}</ul>`;
      return match;
    })
    .replace(/^---+$/gm, '<hr>')
    .replace(/^(?!<[hluod])((?!<).+)$/gm, '<p>$1</p>');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: letter; margin: 1in; }
    body { font-family: 'Calibri', 'Helvetica Neue', sans-serif; font-size: 11pt; line-height: 1.5; color: #333; max-width: 7in; margin: 0 auto; }
    h1 { font-size: 18pt; color: #1e3a5f; margin-top: 24pt; margin-bottom: 8pt; }
    h2 { font-size: 14pt; color: #1e3a5f; margin-top: 18pt; margin-bottom: 6pt; }
    h3 { font-size: 12pt; color: #1e3a5f; margin-top: 14pt; margin-bottom: 4pt; }
    p { margin: 6pt 0; }
    ul, ol { margin: 6pt 0; padding-left: 24pt; }
    li { margin: 3pt 0; }
    hr { border: none; border-top: 1px solid #ccc; margin: 18pt 0; }
    strong { font-weight: 600; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * Main entry point — generate a document in the requested format.
 * @param {{ format: string, title: string, content: string, filename?: string }} params
 * @returns {{ filePath: string, filename: string, contentType: string, title: string }}
 */
export async function generateDocument({ format = 'docx', title, content, filename }) {
  const generator = format === 'pdf' ? generatePdf : generateDocx;
  const result = await generator({ title, content, filename });
  return { ...result, title };
}
