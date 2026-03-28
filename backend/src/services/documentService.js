/**
 * Document Service — Generate DOCX and PDF files from markdown content,
 * upload to Google Drive, and share with users.
 *
 * Features:
 * - Cover page with title, tenant name, date, "Prepared by Coppice AI"
 * - Markdown tables → formatted tables
 * - PDF via wkhtmltopdf or Chrome headless
 * - Google Drive upload + sharing via service account
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, TableRow, TableCell, Table, WidthType, PageBreak,
  ShadingType, Footer, PageNumber, NumberFormat,
} from 'docx';
import { writeFileSync, mkdirSync, existsSync, createReadStream, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '../../data/generated-docs');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

const NAVY = '1e3a5f';
const LIGHT_BG = 'f0f4f8';
const ACCENT = '2d7d46';

// ─── Markdown Parsing ───────────────────────────────────────────────────────

function parseMarkdown(markdown) {
  const lines = markdown.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push({ type: 'hr' });
      i++;
      continue;
    }

    // Table detection: line with | separators
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim();
        // Skip separator rows (|---|---|)
        if (/^\|[\s\-:]+\|/.test(row) && !row.match(/[a-zA-Z0-9]/)) {
          i++;
          continue;
        }
        const cells = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        elements.push({ type: 'table', rows: tableRows });
      }
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      elements.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // List items
    const listMatch = line.match(/^(\s*)([-*]|\d+[.)]) (.+)/);
    if (listMatch) {
      elements.push({ type: 'list', ordered: /\d/.test(listMatch[2]), text: listMatch[3], indent: listMatch[1].length });
      i++;
      continue;
    }

    // Regular paragraph
    elements.push({ type: 'paragraph', text: line.trim() });
    i++;
  }

  return elements;
}

function parseInlineMarkdown(text, fontSize = 22) {
  const runs = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, font: 'Calibri', size: fontSize }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], italics: true, font: 'Calibri', size: fontSize }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], font: 'Calibri', size: fontSize }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text, font: 'Calibri', size: fontSize })];
}

// ─── DOCX Generation ────────────────────────────────────────────────────────

function buildCoverPage(title, meta = {}) {
  const { tenantName, preparedBy, date, classification } = meta;
  return [
    // Spacer
    new Paragraph({ spacing: { before: 4000 }, children: [] }),
    // Title
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: title, bold: true, font: 'Calibri', size: 56, color: NAVY })],
    }),
    // Divider line
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 300 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: ACCENT } },
      children: [],
    }),
    // Prepared for
    ...(tenantName ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: 'Prepared for: ', font: 'Calibri', size: 24, color: '666666' }),
        new TextRun({ text: tenantName, bold: true, font: 'Calibri', size: 24, color: NAVY }),
      ],
    })] : []),
    // Prepared by
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: 'Prepared by: ', font: 'Calibri', size: 24, color: '666666' }),
        new TextRun({ text: preparedBy || 'Coppice AI', bold: true, font: 'Calibri', size: 24, color: ACCENT }),
      ],
    }),
    // Date
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), font: 'Calibri', size: 24, color: '666666' })],
    }),
    // Classification
    ...(classification ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [new TextRun({ text: classification, font: 'Calibri', size: 20, color: '999999', italics: true })],
    })] : []),
    // Page break after cover
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function tableToDocx(rows) {
  if (rows.length === 0) return [];

  const isHeader = rows.length > 1;
  const docxRows = rows.map((cells, rowIdx) => {
    const isHeaderRow = rowIdx === 0 && isHeader;
    return new TableRow({
      tableHeader: isHeaderRow,
      children: cells.map(cellText => new TableCell({
        shading: isHeaderRow
          ? { type: ShadingType.SOLID, color: NAVY, fill: NAVY }
          : rowIdx % 2 === 0 ? { type: ShadingType.SOLID, color: LIGHT_BG, fill: LIGHT_BG } : undefined,
        children: [new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [new TextRun({
            text: cellText,
            bold: isHeaderRow,
            font: 'Calibri',
            size: 20,
            color: isHeaderRow ? 'ffffff' : '333333',
          })],
        })],
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
      })),
    });
  });

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: docxRows,
  }), new Paragraph({ spacing: { after: 200 }, children: [] })];
}

function elementsToDocxParagraphs(elements) {
  const paragraphs = [];

  for (const el of elements) {
    switch (el.type) {
      case 'heading': {
        const headingLevel = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 }[el.level] || HeadingLevel.HEADING_4;
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
      case 'paragraph':
        paragraphs.push(new Paragraph({
          children: parseInlineMarkdown(el.text),
          spacing: { after: 120, line: 276 },
        }));
        break;
      case 'list':
        paragraphs.push(new Paragraph({
          children: parseInlineMarkdown(el.text),
          bullet: el.ordered ? undefined : { level: 0 },
          numbering: el.ordered ? { reference: 'default-numbering', level: 0 } : undefined,
          spacing: { after: 60, line: 276 },
          indent: { left: 720 },
        }));
        break;
      case 'table':
        paragraphs.push(...tableToDocx(el.rows));
        break;
      case 'hr':
        paragraphs.push(new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } },
          spacing: { before: 240, after: 240 },
        }));
        break;
    }
  }

  return paragraphs;
}

/**
 * Generate a DOCX file with cover page and formatted content.
 */
export async function generateDocx({ title, content, filename, meta = {} }) {
  const elements = parseMarkdown(content);
  const bodyParagraphs = elementsToDocxParagraphs(elements);
  const coverParagraphs = buildCoverPage(title, meta);

  const doc = new Document({
    creator: 'Coppice AI',
    title,
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Coppice AI  |  ', font: 'Calibri', size: 16, color: '999999' }),
                new TextRun({ text: title, font: 'Calibri', size: 16, color: '999999', italics: true }),
                new TextRun({ text: '  |  Page ', font: 'Calibri', size: 16, color: '999999' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 16, color: '999999' }),
              ],
            })],
          }),
        },
        children: [...coverParagraphs, ...bodyParagraphs],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const safeName = (filename || title).replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
  const outputFilename = `${safeName}.docx`;
  const filePath = join(OUTPUT_DIR, outputFilename);
  writeFileSync(filePath, buffer);

  return { filePath, filename: outputFilename, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}

// ─── PDF Generation ─────────────────────────────────────────────────────────

function markdownToStyledHtml(title, markdown, meta = {}) {
  const { tenantName, date, classification } = meta;
  const displayDate = date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Convert markdown tables to HTML tables
  let html = markdown;

  // Tables: find blocks of | delimited lines
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n');
    let tableHtml = '<table>';
    let isFirstRow = true;
    for (const row of rows) {
      if (/^\|[\s\-:]+\|$/.test(row)) continue; // skip separator
      const cells = row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
      const tag = isFirstRow ? 'th' : 'td';
      tableHtml += `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
      if (isFirstRow) isFirstRow = false;
    }
    tableHtml += '</table>';
    return tableHtml;
  });

  // Standard markdown conversions
  html = html
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul>${m}</ul>`)
    .replace(/^---+$/gm, '<hr>')
    .replace(/←/g, '&larr;')
    .replace(/^(?!<[hluodtp])((?!<).+)$/gm, '<p>$1</p>');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: letter; margin: 0.8in 1in; }
    body { font-family: 'Helvetica Neue', 'Calibri', sans-serif; font-size: 10.5pt; line-height: 1.6; color: #333; max-width: 7in; margin: 0 auto; }

    /* Cover page */
    .cover { page-break-after: always; text-align: center; padding-top: 3in; }
    .cover h1 { font-size: 28pt; color: #1e3a5f; margin-bottom: 0.3in; font-weight: 700; }
    .cover .divider { width: 3in; height: 3px; background: #2d7d46; margin: 0.3in auto; }
    .cover .meta { font-size: 11pt; color: #666; margin: 0.1in 0; }
    .cover .meta strong { color: #1e3a5f; }
    .cover .classification { font-size: 9pt; color: #999; font-style: italic; margin-top: 1in; }

    h1 { font-size: 18pt; color: #1e3a5f; margin-top: 24pt; margin-bottom: 8pt; border-bottom: 2px solid #e0e0e0; padding-bottom: 4pt; }
    h2 { font-size: 14pt; color: #1e3a5f; margin-top: 18pt; margin-bottom: 6pt; }
    h3 { font-size: 12pt; color: #1e3a5f; margin-top: 14pt; margin-bottom: 4pt; }
    h4 { font-size: 11pt; color: #1e3a5f; margin-top: 10pt; margin-bottom: 4pt; }
    p { margin: 6pt 0; }
    ul, ol { margin: 6pt 0; padding-left: 20pt; }
    li { margin: 3pt 0; }
    hr { border: none; border-top: 1px solid #ccc; margin: 18pt 0; }
    strong { font-weight: 600; }

    table { width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 10pt; }
    th { background: #1e3a5f; color: white; font-weight: 600; text-align: left; padding: 8px 10px; }
    td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; }
    tr:nth-child(even) td { background: #f8f9fb; }

    .footer { text-align: center; font-size: 8pt; color: #999; margin-top: 1in; border-top: 1px solid #e0e0e0; padding-top: 6pt; }
  </style>
</head>
<body>
  <div class="cover">
    <h1>${title}</h1>
    <div class="divider"></div>
    ${tenantName ? `<p class="meta">Prepared for: <strong>${tenantName}</strong></p>` : ''}
    <p class="meta">Prepared by: <strong>Coppice AI</strong></p>
    <p class="meta">${displayDate}</p>
    ${classification ? `<p class="classification">${classification}</p>` : ''}
  </div>
${html}
  <div class="footer">Coppice AI &mdash; ${title} &mdash; ${displayDate}</div>
</body>
</html>`;
}

export async function generatePdf({ title, content, filename, meta = {} }) {
  const safeName = (filename || title).replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
  const html = markdownToStyledHtml(title, content, meta);
  const htmlPath = join(OUTPUT_DIR, `${safeName}_temp.html`);
  const pdfPath = join(OUTPUT_DIR, `${safeName}.pdf`);
  writeFileSync(htmlPath, html);

  let generated = false;

  // Try wkhtmltopdf first (installed on VPS)
  if (!generated) {
    try {
      execSync(`wkhtmltopdf --quiet --enable-local-file-access --page-size Letter --margin-top 20mm --margin-bottom 20mm --margin-left 25mm --margin-right 25mm "${htmlPath}" "${pdfPath}"`, {
        timeout: 30000, stdio: 'pipe',
      });
      generated = true;
    } catch { /* fallback */ }
  }

  // Try Chrome headless
  if (!generated) {
    const chromePaths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    for (const cp of chromePaths) {
      try {
        execSync(`"${cp}" --headless=new --no-sandbox --disable-gpu --print-to-pdf="${pdfPath}" --no-pdf-header-footer "file://${htmlPath}"`, {
          timeout: 30000, stdio: 'pipe',
        });
        generated = true;
        break;
      } catch { continue; }
    }
  }

  // Clean up temp HTML
  try { unlinkSync(htmlPath); } catch {}

  if (generated) {
    return { filePath: pdfPath, filename: `${safeName}.pdf`, contentType: 'application/pdf' };
  }

  console.warn('[DocumentService] No PDF converter available, falling back to DOCX');
  return generateDocx({ title, content, filename, meta });
}

// ─── Google Drive Upload ────────────────────────────────────────────────────

const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '/root/google-service-account.json';

async function getServiceDrive() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Upload a DOCX file to Google Drive and convert to Google Doc.
 * Share with the specified email(s).
 */
export async function uploadToGoogleDrive({ filePath, title, shareWithEmails = [] }) {
  try {
    const drive = await getServiceDrive();

    // Upload as Google Doc (auto-convert from DOCX)
    const res = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: createReadStream(filePath),
      },
      fields: 'id, webViewLink',
    });

    const fileId = res.data.id;
    const webViewLink = res.data.webViewLink;

    // Share with each email
    for (const email of shareWithEmails) {
      if (!email || email.includes('localhost')) continue;
      try {
        await drive.permissions.create({
          fileId,
          requestBody: { role: 'writer', type: 'user', emailAddress: email },
          sendNotificationEmail: false,
        });
      } catch (shareErr) {
        console.warn(`[DocumentService] Failed to share with ${email}: ${shareErr.message}`);
        // Try making it accessible via link instead
        try {
          await drive.permissions.create({
            fileId,
            requestBody: { role: 'writer', type: 'anyone' },
          });
        } catch {}
      }
    }

    console.log(`[DocumentService] Uploaded to Google Drive: ${webViewLink}`);
    return { fileId, webViewLink };
  } catch (err) {
    console.error(`[DocumentService] Google Drive upload failed: ${err.message}`);
    return null;
  }
}

// ─── Full Report Pipeline ───────────────────────────────────────────────────

/**
 * Generate a complete report: DOCX + PDF + Google Doc.
 * Returns artifact metadata to store on the assignment.
 *
 * @param {{ title, content, tenantName, agentName, userEmail, assignmentId }} params
 * @returns {{ docxPath, pdfPath, gdocUrl, gdocId, artifacts }}
 */
export async function generateReport({ title, content, tenantName, agentName, userEmail, assignmentId }) {
  const meta = {
    tenantName: tenantName || 'Coppice Client',
    preparedBy: agentName || 'Coppice AI',
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    classification: 'Internal Use Only',
  };

  const safeName = (assignmentId || title).replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');

  // Generate DOCX
  const docx = await generateDocx({ title, content, filename: safeName, meta });
  console.log(`[DocumentService] Generated DOCX: ${docx.filePath}`);

  // Generate PDF
  const pdf = await generatePdf({ title, content, filename: safeName, meta });
  const pdfGenerated = pdf.contentType === 'application/pdf';
  console.log(`[DocumentService] Generated PDF: ${pdfGenerated ? pdf.filePath : 'failed, using DOCX fallback'}`);

  // Upload to Google Drive
  const shareEmails = userEmail ? [userEmail] : [];
  const gdoc = await uploadToGoogleDrive({ filePath: docx.filePath, title, shareWithEmails: shareEmails });

  const artifacts = [
    { type: 'docx', label: 'Word Document', path: `/v1/estimates/assignments/${assignmentId}/download/docx`, filename: docx.filename },
    ...(pdfGenerated ? [{ type: 'pdf', label: 'PDF', path: `/v1/estimates/assignments/${assignmentId}/download/pdf`, filename: pdf.filename }] : []),
    ...(gdoc ? [{ type: 'gdoc', label: 'Google Docs', url: gdoc.webViewLink, fileId: gdoc.fileId }] : []),
  ];

  return {
    docxPath: docx.filePath,
    pdfPath: pdfGenerated ? pdf.filePath : null,
    gdocUrl: gdoc?.webViewLink || null,
    gdocId: gdoc?.fileId || null,
    artifacts,
  };
}

/**
 * Main entry point — generate a document in the requested format.
 */
export async function generateDocument({ format = 'docx', title, content, filename, meta = {} }) {
  const generator = format === 'pdf' ? generatePdf : generateDocx;
  const result = await generator({ title, content, filename, meta });
  return { ...result, title };
}
