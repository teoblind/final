/**
 * File Parser Service — extract text content from uploaded files
 *
 * Supports: PDF, DOCX, CSV, TXT, XLSX, and images (PNG/JPG).
 * Returns structured text for injection into chat context.
 */

import { readFileSync } from 'fs';

const MAX_TEXT_LENGTH = 30_000;

/**
 * Parse an uploaded file and extract its text content.
 * @param {string} filePath - Path to the uploaded file on disk
 * @param {string} mimeType - MIME type of the file
 * @param {string} originalName - Original filename
 * @returns {Promise<{ text: string, type: string, pageCount?: number, isImage?: boolean, base64?: string, mediaType?: string }>}
 */
export async function parseFile(filePath, mimeType, originalName) {
  const mime = (mimeType || '').toLowerCase();
  const ext = (originalName || '').split('.').pop()?.toLowerCase() || '';

  // PDF
  if (mime === 'application/pdf' || ext === 'pdf') {
    return await parsePDF(filePath);
  }

  // DOCX
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
    return await parseDOCX(filePath);
  }

  // XLSX
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx') {
    return await parseXLSX(filePath);
  }

  // CSV
  if (mime === 'text/csv' || ext === 'csv') {
    return parseTextFile(filePath, 'csv');
  }

  // Plain text / markdown / JSON / code files
  if (mime.startsWith('text/') || ['txt', 'md', 'json', 'js', 'ts', 'py', 'html', 'css', 'xml', 'yaml', 'yml'].includes(ext)) {
    return parseTextFile(filePath, ext || 'txt');
  }

  // Images
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    return parseImage(filePath, mime || `image/${ext === 'jpg' ? 'jpeg' : ext}`);
  }

  throw new Error(`Unsupported file type: ${mime || ext}. Supported: PDF, DOCX, XLSX, CSV, TXT, PNG, JPG`);
}

async function parsePDF(filePath) {
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);

  let text = data.text || '';
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
  }

  return {
    text,
    type: 'pdf',
    pageCount: data.numpages,
  };
}

async function parseDOCX(filePath) {
  const mammoth = await import('mammoth');
  const buffer = readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });

  let text = result.value || '';
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
  }

  return { text, type: 'docx' };
}

async function parseXLSX(filePath) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = [];
  workbook.eachSheet((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cell.text || cell.value?.toString() || '');
      });
      rows.push(cells.join('\t'));
    });
    if (rows.length > 0) {
      sheets.push(`## Sheet: ${sheet.name}\n${rows.join('\n')}`);
    }
  });

  let text = sheets.join('\n\n');
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
  }

  return { text, type: 'xlsx' };
}

function parseTextFile(filePath, ext) {
  let text = readFileSync(filePath, 'utf-8');
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
  }
  return { text, type: ext };
}

function parseImage(filePath, mimeType) {
  const buffer = readFileSync(filePath);
  const base64 = buffer.toString('base64');

  // Normalize media type for Claude API
  const mediaMap = {
    'image/jpg': 'image/jpeg',
  };
  const mediaType = mediaMap[mimeType] || mimeType;

  // Check size — Claude's limit is ~5MB for base64 images
  const sizeMB = buffer.length / (1024 * 1024);
  if (sizeMB > 5) {
    console.warn(`[FileParser] Image too large for vision: ${filePath} (${sizeMB.toFixed(1)} MB)`);
    return {
      text: `[Uploaded image: ${filePath.split('/').pop()}] (${sizeMB.toFixed(1)} MB — too large for vision analysis, max 5 MB)`,
      type: 'image',
      isImage: true,
      imageTooLarge: true,
      base64: null,
      mediaType,
    };
  }

  return {
    text: '',
    type: 'image',
    isImage: true,
    base64,
    mediaType,
  };
}
