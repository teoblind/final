/**
 * Document Service - Generate styled PDF reports from markdown content,
 * upload to Google Drive, and share with users.
 *
 * Pipeline: Markdown -> Research-style HTML (gradient cover, tight body) -> Chrome headless PDF -> Drive upload
 *
 * Features:
 * - Gradient cover page with title, tenant name, date, accent keyword
 * - Ultra-tight body text (11px Inter, 1.5 line-height)
 * - Color-coded callout boxes, stat grids, risk tags
 * - Markdown tables -> styled HTML tables
 * - Chrome headless PDF rendering (wkhtmltopdf fallback)
 * - Google Drive upload + sharing via service account
 */

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

// ---- Theme presets (gradient + accent color per industry/type) ----

const THEMES = {
  analysis: {
    gradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 40%, #2d1b69 70%, #4a1a8a 100%)',
    radialOverlay: `radial-gradient(circle at 70% 30%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 30% 70%, rgba(168, 85, 247, 0.1) 0%, transparent 50%)`,
    accent: '#a78bfa',
    h3Color: '#4a1a8a',
    statColor: '#4a1a8a',
  },
  research: {
    gradient: 'linear-gradient(135deg, #0a1628 0%, #0d2137 30%, #1a3a5c 60%, #2d5a3f 100%)',
    radialOverlay: `radial-gradient(circle at 60% 40%, rgba(45, 90, 63, 0.2) 0%, transparent 50%),
                    radial-gradient(circle at 40% 60%, rgba(29, 78, 137, 0.15) 0%, transparent 50%)`,
    accent: '#6ee7b7',
    h3Color: '#1a5c3a',
    statColor: '#166534',
  },
  construction: {
    gradient: 'linear-gradient(135deg, #1a0f0a 0%, #2d1f14 30%, #4a3728 60%, #5c4a3a 100%)',
    radialOverlay: `radial-gradient(circle at 60% 40%, rgba(180, 130, 70, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 40% 60%, rgba(120, 80, 40, 0.1) 0%, transparent 50%)`,
    accent: '#d4a574',
    h3Color: '#8b6914',
    statColor: '#7c5c1e',
  },
  default: {
    gradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 40%, #1e3a5f 70%, #2d5a3f 100%)',
    radialOverlay: `radial-gradient(circle at 70% 30%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 30% 70%, rgba(16, 185, 129, 0.1) 0%, transparent 50%)`,
    accent: '#60a5fa',
    h3Color: '#1e3a5f',
    statColor: '#1e3a5f',
  },
};

// ---- Plain text (Google Docs export) -> Markdown conversion ----

/**
 * Detect if content is Google Docs plain text export (not markdown).
 * Google Docs exports use tab-indented tables, ________________ separators,
 * and numbered headings without # prefixes.
 */
function isGoogleDocPlainText(text) {
  const hasUnderscoreSeparators = (text.match(/_{10,}/g) || []).length >= 2;
  const hasTabIndents = (text.match(/^\t/gm) || []).length >= 3;
  const lacksMarkdownHeadings = !(/#\s/.test(text));
  return hasUnderscoreSeparators && hasTabIndents && lacksMarkdownHeadings;
}

/**
 * Convert Google Docs plain text export into clean markdown.
 * Handles: numbered headings, tab-separated tables, ____ separators, * bullets.
 */
function googleDocToMarkdown(text) {
  let lines = text.split('\n');
  let md = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i];

    // Skip ____ separators -> horizontal rule
    if (/^_{5,}$/.test(line.trim())) {
      md.push('---');
      i++;
      continue;
    }

    // Detect Google Doc table blocks.
    // Google Docs export format:
    //   First column header (NO tab): "Detail"
    //   Remaining column headers (tab-indented): "\tInfo"
    //   Blank line
    //   All data cells (tab-indented): "\tDelivery Method", "\tCMAR", ...
    // Data cells are grouped into rows by column count.
    if (line.trim().length > 0 && line.trim().length < 80 && !/^\t/.test(line) &&
        i + 1 < lines.length && /^\t/.test(lines[i + 1])) {
      // Potential table: non-tab line followed by tab-indented line(s)
      const headerCols = [line.trim()];
      let j = i + 1;

      // Collect remaining header columns (tab-indented, before blank line)
      while (j < lines.length && /^\t/.test(lines[j]) && lines[j].trim().length > 0) {
        headerCols.push(lines[j].trim());
        j++;
      }

      // Skip blank/whitespace lines
      while (j < lines.length && lines[j].trim() === '') j++;

      // Collect all subsequent tab-indented cell values
      const cellValues = [];
      while (j < lines.length) {
        const ln = lines[j];
        if (/^\t/.test(ln) && ln.trim().length > 0) {
          cellValues.push(ln.trim());
          j++;
        } else if (ln.trim() === '') {
          j++; // skip blank lines between rows
        } else {
          break;
        }
      }

      const numCols = headerCols.length;
      if (numCols >= 2 && cellValues.length >= numCols) {
        // Build markdown table
        md.push('| ' + headerCols.join(' | ') + ' |');
        md.push('| ' + headerCols.map(() => '---').join(' | ') + ' |');

        // Group cells into rows of numCols
        for (let c = 0; c + numCols - 1 < cellValues.length; c += numCols) {
          const row = cellValues.slice(c, c + numCols);
          while (row.length < numCols) row.push('');
          md.push('| ' + row.join(' | ') + ' |');
        }
        md.push('');
        i = j;
        continue;
      }
      // Not a table — fall through to other handlers
    }

    // Numbered section headings: "1. Title" or "2. Title" at start of line
    if (/^\d+\.\s+[A-Z]/.test(line.trim()) && line.trim().length < 100) {
      const heading = line.trim().replace(/^\d+\.\s+/, '');
      md.push(`## ${heading}`);
      i++;
      continue;
    }

    // Sub-section headings: "2.1 Title" or "Step 1 —" patterns
    if (/^\d+\.\d+\s+/.test(line.trim()) && line.trim().length < 120) {
      const heading = line.trim();
      md.push(`### ${heading}`);
      i++;
      continue;
    }

    // "Step N —" headings
    if (/^Step\s+\d+\s*[—–-]/i.test(line.trim())) {
      md.push(`### ${line.trim()}`);
      i++;
      continue;
    }

    // Standalone short bold-looking lines (all caps or title case, < 80 chars, no punctuation at end)
    // These are likely sub-headings from the Google Doc
    if (line.trim().length > 0 && line.trim().length < 80 &&
        !line.trim().endsWith('.') && !line.trim().endsWith(',') &&
        !line.trim().startsWith('*') && !line.trim().startsWith('-') &&
        !/\t/.test(line) &&
        i + 1 < lines.length && lines[i + 1].trim() === '') {
      // Check if next non-empty line is body text (not another heading)
      let nextNonEmpty = i + 2;
      while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') nextNonEmpty++;
      if (nextNonEmpty < lines.length && lines[nextNonEmpty].trim().length > 80) {
        // This line is likely a heading followed by body text
        md.push(`### ${line.trim()}`);
        i++;
        continue;
      }
    }

    // "* " bullets -> "- " (markdown standard)
    if (/^\*\s+/.test(line.trim())) {
      md.push(line.replace(/^\*\s+/, '- '));
      i++;
      continue;
    }

    // Regular line
    md.push(line);
    i++;
  }

  return md.join('\n');
}

// ---- Markdown -> HTML conversion ----

/** Strip conversational agent text that shouldn't appear in a formal report */
function cleanForReport(text) {
  let cleaned = text;
  // Remove specific agent chat indicator lines (not content lines that happen to have emoji)
  cleaned = cleaned.replace(/^.*[✅].*$/gm, ''); // checkmark = status line
  cleaned = cleaned.replace(/^[📄📁📋🔗💡🤖]\s.*$/gm, ''); // emoji at START of line = agent metadata
  // Remove conversational preamble/postamble
  cleaned = cleaned.replace(/^(The Google Doc is live\.?.*|Here['']s the (?:full )?summary:?.*|I['']ve (?:created|generated|uploaded|prepared|built|saved|shared).*|The (?:report|document|brief) (?:is|has been).*|Let me know if.*|Would you like.*|I haven['']t sent an email.*|Per standing policy.*)$/gmi, '');
  // Remove "Document:" / "Saved to:" / "Full Report:" reference lines
  cleaned = cleaned.replace(/^.*(?:Document:|Saved to:|Full Report:|Open in Google).*$/gmi, '');
  // Remove markdown link syntax but keep text: [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1');
  // Remove raw URLs on their own line
  cleaned = cleaned.replace(/^\s*https?:\/\/\S+\s*$/gm, '');
  // Remove "Note: Per standing policy..." agent disclaimers
  cleaned = cleaned.replace(/^\*?Note:?\s*Per standing policy.*$/gmi, '');
  // Remove triple+ blank lines, collapse to double
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  // Remove leading/trailing blank lines
  cleaned = cleaned.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
  return cleaned;
}

function markdownToHtml(markdown) {
  // If content is Google Docs plain text export, convert to markdown first
  let cleaned = cleanForReport(markdown);
  if (isGoogleDocPlainText(cleaned)) {
    cleaned = googleDocToMarkdown(cleaned);
  }
  let html = cleaned;

  // Tables: find blocks of | delimited lines
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n');
    let tableHtml = '<table>';
    let isFirstRow = true;
    for (const row of rows) {
      if (/^\|[\s\-:|]+\|$/.test(row) || /^[\s\-:|]+$/.test(row)) continue;
      const cells = row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
      const tag = isFirstRow ? 'th' : 'td';
      tableHtml += `<tr>${cells.map(c => `<${tag}>${inlineFormat(c)}</${tag}>`).join('')}</tr>`;
      if (isFirstRow) isFirstRow = false;
    }
    tableHtml += '</table>';
    return tableHtml;
  });

  // Headings
  html = html
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Inline formatting
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/gs, (m) => {
    const isOrdered = false; // simplified - could detect from original
    const tag = isOrdered ? 'ol' : 'ul';
    return `<${tag}>${m}</${tag}>`;
  });

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Paragraphs - lines that aren't already HTML
  html = html.replace(/^(?!<[hluodtp]|<\/|<table|<tr|<th|<td|$)((?!<).+)$/gm, '<p>$1</p>');

  return html;
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/**
 * Extract a "highlight word" from the title for the accent-colored span on the cover.
 * Picks the last significant word (skipping common prepositions/articles).
 */
function extractAccentWord(title) {
  const skip = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'in', 'on', 'at', 'to', 'by', '-', '&']);
  const words = title.split(/\s+/).filter(w => !skip.has(w.toLowerCase()));
  if (words.length <= 1) return { before: title, accent: '', after: '' };

  // Use the last word as accent, or a proper noun if found
  const accentIdx = words.length - 1;
  const accentWord = words[accentIdx];
  const titleWords = title.split(/\s+/);
  const idx = titleWords.indexOf(accentWord);
  if (idx === -1) return { before: title, accent: '', after: '' };

  const before = titleWords.slice(0, idx).join(' ');
  const after = titleWords.slice(idx + 1).join(' ');
  return { before: before ? before + ' ' : '', accent: accentWord, after: after ? ' ' + after : '' };
}

// ---- Research-style HTML builder ----

function buildResearchHtml(title, bodyHtml, meta = {}, theme = 'default') {
  const t = THEMES[theme] || THEMES.default;
  const { tenantName, date, classification, subtitle, label } = meta;
  const displayDate = date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const coverLabel = label || 'Analysis Report';
  const { before, accent, after } = extractAccentWord(title);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px !important;
  color: #1a1a2e;
  line-height: 1.5;
  background: #fff;
}

/* Cover page */
.cover {
  height: 100vh;
  background: ${t.gradient};
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 80px;
  color: white;
  position: relative;
  overflow: hidden;
  page-break-after: always;
}
.cover::before {
  content: '';
  position: absolute;
  top: -50%; left: -50%;
  width: 200%; height: 200%;
  background: ${t.radialOverlay};
}
.cover-label {
  font-size: 13px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: rgba(255,255,255,0.5);
  margin-bottom: 24px;
  position: relative;
}
.cover h1 {
  font-size: 48px;
  font-weight: 700;
  line-height: 1.1;
  margin-bottom: 16px;
  position: relative;
}
.cover h1 span { color: ${t.accent}; }
.cover .cover-subtitle {
  font-size: 20px;
  font-weight: 300;
  color: rgba(255,255,255,0.7);
  margin-bottom: 48px;
  position: relative;
}
.cover-meta {
  position: relative;
  font-size: 14px;
  color: rgba(255,255,255,0.4);
  border-top: 1px solid rgba(255,255,255,0.1);
  padding-top: 24px;
}
.cover-meta strong { color: rgba(255,255,255,0.7); }

/* Content pages */
.content {
  max-width: 800px;
  margin: 0 auto;
  padding: 30px 36px;
}
h2 {
  font-size: 16px !important;
  font-weight: 700;
  color: #1a1a2e;
  margin: 20px 0 4px;
  padding-bottom: 4px;
  border-bottom: 1.5px solid #e2e8f0;
}
h2:first-child { margin-top: 0; }
h3 {
  font-size: 12px !important;
  font-weight: 600;
  color: ${t.h3Color};
  margin: 12px 0 3px;
}
h4 {
  font-size: 10px !important;
  font-weight: 600;
  color: #64748b;
  margin: 8px 0 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
p { margin: 3px 0; font-size: 11px !important; line-height: 1.5; }
ul, ol { margin: 3px 0 3px 18px; font-size: 11px !important; }
li { margin: 1px 0; line-height: 1.45; font-size: 11px !important; }
strong { font-weight: 600; }
code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 10px; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 12px 0; }

/* Callout boxes */
.callout {
  background: #eff6ff;
  border-left: 3px solid #3b82f6;
  padding: 6px 12px;
  margin: 8px 0;
  border-radius: 0 6px 6px 0;
  font-size: 10.5px;
}
.callout-warning {
  background: #fff7ed;
  border-left: 3px solid #f97316;
  padding: 6px 12px;
  margin: 8px 0;
  border-radius: 0 6px 6px 0;
  font-size: 10.5px;
}
.callout-danger {
  background: #fef2f2;
  border-left: 3px solid #ef4444;
  padding: 6px 12px;
  margin: 8px 0;
  border-radius: 0 6px 6px 0;
  font-size: 10.5px;
}
.callout-success {
  background: #f0fdf4;
  border-left: 3px solid #22c55e;
  padding: 6px 12px;
  margin: 8px 0;
  border-radius: 0 6px 6px 0;
  font-size: 10.5px;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 10.5px;
}
th {
  background: #f1f5f9;
  padding: 5px 8px;
  text-align: left;
  font-weight: 600;
  border-bottom: 1.5px solid #e2e8f0;
}
td {
  padding: 4px 8px;
  border-bottom: 1px solid #f1f5f9;
}
tr:hover td { background: #fafafa; }

/* Stat grids */
.key-stat {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 10px;
  margin: 6px 0;
}
.key-stat .label { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
.key-stat .value { font-size: 14px; font-weight: 700; color: ${t.statColor}; }
.key-stat .context { font-size: 9px; color: #64748b; }
.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  margin: 6px 0;
}

/* Risk tags */
.risk-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; }
.risk-high { background: #fee2e2; color: #dc2626; }
.risk-medium { background: #fef3c7; color: #d97706; }
.risk-low { background: #d1fae5; color: #059669; }

/* Footer */
.doc-footer {
  text-align: center;
  font-size: 8px;
  color: #94a3b8;
  margin-top: 32px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
}

@media print {
  .cover { height: 100vh; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover">
  <div class="cover-label">${coverLabel}</div>
  <h1>${before}<span>${accent}</span>${after}</h1>
  ${subtitle ? `<div class="cover-subtitle">${subtitle}</div>` : ''}
  <div class="cover-meta">
    ${tenantName ? `<strong>Prepared for:</strong> ${tenantName}<br>` : ''}
    <strong>Date:</strong> ${displayDate}<br>
    <strong>Prepared by:</strong> ${meta.agentLabel || 'Coppice AI'}<br>
    ${classification ? `<strong>Classification:</strong> ${classification}` : ''}
  </div>
</div>

<!-- BODY -->
<div class="content">
${bodyHtml}
<div class="doc-footer">${meta.agentLabel || 'Coppice AI'} - ${title} - ${displayDate}</div>
</div>

</body>
</html>`;
}

// ---- PDF Generation ----

/**
 * Generate a styled PDF from markdown content using the Research style.
 */
export async function generatePdf({ title, content, filename, meta = {}, theme }) {
  const safeName = (filename || title).replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
  const bodyHtml = markdownToHtml(content);
  const resolvedTheme = theme || meta.theme || 'default';
  const html = buildResearchHtml(title, bodyHtml, meta, resolvedTheme);
  const htmlPath = join(OUTPUT_DIR, `${safeName}_temp.html`);
  const pdfPath = join(OUTPUT_DIR, `${safeName}.pdf`);
  writeFileSync(htmlPath, html);

  let generated = false;

  // Try Chrome headless first (best rendering for gradients/fonts)
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ];
  for (const cp of chromePaths) {
    try {
      execSync(`"${cp}" --headless=new --no-sandbox --disable-gpu --print-to-pdf="${pdfPath}" --no-pdf-header-footer --print-background "file://${htmlPath}"`, {
        timeout: 30000, stdio: 'pipe',
      });
      generated = true;
      break;
    } catch { continue; }
  }

  // Fallback: wkhtmltopdf
  if (!generated) {
    try {
      execSync(`wkhtmltopdf --quiet --enable-local-file-access --page-size Letter --margin-top 0 --margin-bottom 0 --margin-left 0 --margin-right 0 "${htmlPath}" "${pdfPath}"`, {
        timeout: 30000, stdio: 'pipe',
      });
      generated = true;
    } catch { /* no PDF converter */ }
  }

  // Clean up temp HTML
  try { unlinkSync(htmlPath); } catch {}

  if (!generated) {
    console.warn('[DocumentService] No PDF converter available');
    return null;
  }

  return { filePath: pdfPath, filename: `${safeName}.pdf`, contentType: 'application/pdf' };
}

/**
 * Generate just the HTML (for preview or custom rendering).
 */
export function generateHtml({ title, content, meta = {}, theme }) {
  const bodyHtml = markdownToHtml(content);
  const resolvedTheme = theme || meta.theme || 'default';
  return buildResearchHtml(title, bodyHtml, meta, resolvedTheme);
}

// ---- Google Drive Upload ----

const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '/root/google-service-account.json';

/** Get Drive client using tenant's OAuth token (real Workspace storage) */
async function getTenantDrive(tenantId) {
  if (!tenantId) return null;
  try {
    const { getTenantDb } = await import('../cache/database.js');
    const tdb = getTenantDb(tenantId);
    const row = tdb.prepare('SELECT gmail_refresh_token FROM tenant_email_config WHERE tenant_id = ? LIMIT 1').get(tenantId);
    if (!row?.gmail_refresh_token) return null;
    const oauth2 = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: row.gmail_refresh_token });
    return google.drive({ version: 'v3', auth: oauth2 });
  } catch (err) {
    console.warn(`[DocumentService] Tenant OAuth drive failed: ${err.message}`);
    return null;
  }
}

async function getServiceDrive() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Upload a PDF to Google Drive.
 * Share with the specified email(s).
 * Optionally place in a specific folder.
 */
export async function uploadToGoogleDrive({ filePath, title, shareWithEmails = [], folderId, supersedePrevious, tenantId }) {
  try {
    // Try tenant OAuth first (has real Workspace storage), fall back to service account
    let drive = tenantId ? await getTenantDrive(tenantId) : null;
    const usingTenantOAuth = !!drive;
    if (!drive) drive = await getServiceDrive();

    const requestBody = { name: title };
    if (folderId) requestBody.parents = [folderId];

    // If superseding previous files in the folder, rename them first
    if (supersedePrevious && folderId) {
      try {
        const existing = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false and mimeType = 'application/pdf'`,
          fields: 'files(id, name)',
        });
        for (const f of (existing.data.files || [])) {
          if (!f.name.startsWith('SUPERSEDED - ')) {
            await drive.files.update({
              fileId: f.id,
              requestBody: { name: `SUPERSEDED - ${f.name}` },
            });
            console.log(`[DocumentService] Marked superseded: ${f.name}`);
          }
        }
      } catch (err) {
        console.warn(`[DocumentService] Failed to supersede old files: ${err.message}`);
      }
    }

    const res = await drive.files.create({
      requestBody,
      media: {
        mimeType: 'application/pdf',
        body: createReadStream(filePath),
      },
      fields: 'id, webViewLink',
    });

    const fileId = res.data.id;
    const webViewLink = res.data.webViewLink;

    // Make file viewable by anyone with link (so "Open in Google Docs" always works)
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    } catch (permErr) {
      console.warn(`[DocumentService] Failed to set public access: ${permErr.message}`);
    }

    // Also share as writer with specific emails
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
      }
    }

    console.log(`[DocumentService] Uploaded PDF to Google Drive: ${webViewLink}`);
    return { fileId, webViewLink };
  } catch (err) {
    console.error(`[DocumentService] Google Drive upload failed: ${err.message}`);
    return null;
  }
}

// ---- Full Report Pipeline ----

/**
 * Generate a complete report: Research-style PDF + Google Drive upload.
 * Returns artifact metadata to store on the assignment.
 *
 * @param {{ title, content, tenantName, agentName, userEmail, assignmentId, theme, folderId, subtitle, label }} params
 * @returns {{ pdfPath, gdocUrl, gdocId, artifacts }}
 */
export async function generateReport({ title, content, tenantName, agentName, agentLabel, userEmail, assignmentId, theme, folderId, subtitle, label, tenantId }) {
  const meta = {
    tenantName: tenantName || 'Coppice Client',
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    classification: 'Internal Use Only',
    subtitle: subtitle || null,
    label: label || null,
    theme: theme || null,
    agentLabel: agentLabel || agentName || 'Coppice AI',
  };

  const safeName = (assignmentId || title).replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');

  // Generate PDF (primary output)
  const pdf = await generatePdf({ title, content, filename: safeName, meta, theme });
  if (!pdf) {
    console.error('[DocumentService] PDF generation failed');
    return { pdfPath: null, docxPath: null, gdocUrl: null, gdocId: null, artifacts: [] };
  }
  console.log(`[DocumentService] Generated PDF: ${pdf.filePath}`);

  // Generate Word doc (HTML saved as .doc — Word opens natively)
  const docxFilename = `${safeName}.doc`;
  const docxPath = join(OUTPUT_DIR, docxFilename);
  try {
    const docHtml = generateHtml({ title, content, meta, theme });
    writeFileSync(docxPath, docHtml);
    console.log(`[DocumentService] Generated DOC: ${docxPath}`);
  } catch (docErr) {
    console.warn(`[DocumentService] DOC generation failed: ${docErr.message}`);
  }

  // Upload PDF to Google Drive
  const shareEmails = userEmail ? [userEmail] : [];
  const gdoc = await uploadToGoogleDrive({
    filePath: pdf.filePath,
    title: `${title}.pdf`,
    shareWithEmails: shareEmails,
    folderId: folderId || null,
    supersedePrevious: !!folderId,
    tenantId,
  });

  const artifacts = [
    { type: 'pdf', label: 'PDF Report', path: `/v1/estimates/assignments/${assignmentId}/download/pdf`, filename: pdf.filename },
    ...(existsSync(docxPath) ? [{ type: 'docx', label: 'Word Doc', path: `/v1/estimates/assignments/${assignmentId}/download/docx`, filename: docxFilename }] : []),
    ...(gdoc ? [{ type: 'gdoc', label: 'Google Docs', url: gdoc.webViewLink, fileId: gdoc.fileId }] : []),
  ];

  return {
    pdfPath: pdf.filePath,
    docxPath: existsSync(docxPath) ? docxPath : null,
    gdocUrl: gdoc?.webViewLink || null,
    gdocId: gdoc?.fileId || null,
    artifacts,
  };
}

/**
 * Main entry point - generate a document in the requested format.
 */
export async function generateDocument({ format = 'pdf', title, content, filename, meta = {}, theme }) {
  return generatePdf({ title, content, filename, meta, theme });
}

export default { generatePdf, generateHtml, generateReport, generateDocument, uploadToGoogleDrive };
