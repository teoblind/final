import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, Footer, PageNumber, Header, PageBreak,
  convertInchesToTwip, LevelFormat, Tab, TabStopType, TabStopPosition
} from 'docx';
import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'cache.db');
const OUT_DIR = path.join(ROOT, 'demo-files', 'leads');

mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

const NAVY = '1e3a5f';
const GREEN = '1a6b3c';
const DARK_GRAY = '333333';
const GRAY = '666666';
const LIGHT_GRAY = 'f5f5f5';
const WHITE = 'ffffff';
const RED = 'cc0000';

function heading1(text, color) {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [
      new TextRun({ text, bold: true, size: 36, color, font: 'Calibri' }),
    ],
  });
}

function heading2(text, color = DARK_GRAY) {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [
      new TextRun({ text, bold: true, size: 28, color, font: 'Calibri' }),
    ],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text, size: 22, font: 'Calibri', color: DARK_GRAY, ...opts }),
    ],
  });
}

function bodyRuns(runs) {
  return new Paragraph({
    spacing: { after: 120 },
    children: runs.map(r => new TextRun({ size: 22, font: 'Calibri', color: DARK_GRAY, ...r })),
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 200 }, children: [] });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function thinBorders() {
  const b = { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' };
  return { top: b, bottom: b, left: b, right: b };
}

function headerCell(text, accentColor, width) {
  return new TableCell({
    shading: { fill: accentColor, type: ShadingType.CLEAR },
    borders: thinBorders(),
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 20, color: WHITE, font: 'Calibri' })],
      }),
    ],
  });
}

function dataCell(text, shade, width) {
  return new TableCell({
    shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
    borders: thinBorders(),
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || '—', size: 20, font: 'Calibri', color: DARK_GRAY })],
      }),
    ],
  });
}

function twoColTable(rows, accentColor) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value], i) =>
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: i % 2 === 0 ? LIGHT_GRAY : WHITE, type: ShadingType.CLEAR },
            borders: thinBorders(),
            width: { size: 4500, type: WidthType.DXA },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: label, bold: true, size: 20, font: 'Calibri', color: accentColor })],
              }),
            ],
          }),
          new TableCell({
            shading: { fill: i % 2 === 0 ? LIGHT_GRAY : WHITE, type: ShadingType.CLEAR },
            borders: thinBorders(),
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: String(value), size: 20, font: 'Calibri', color: DARK_GRAY })],
              }),
            ],
          }),
        ],
      })
    ),
  });
}

function separator() {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc', space: 4 } },
    children: [],
  });
}

function numberedParagraph(num, text) {
  return bodyRuns([
    { text: `${num}. `, bold: true },
    { text },
  ]);
}

function makeFooter(label) {
  return {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `CONFIDENTIAL — ${label} | Page `, size: 16, color: GRAY, font: 'Calibri' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY, font: 'Calibri' }),
          ],
        }),
      ],
    }),
  };
}

function makeDocProps(accent) {
  return {
    page: {
      margin: {
        top: convertInchesToTwip(1),
        right: convertInchesToTwip(1),
        bottom: convertInchesToTwip(1),
        left: convertInchesToTwip(1),
      },
      size: {
        width: convertInchesToTwip(8.5),
        height: convertInchesToTwip(11),
      },
    },
  };
}

// ── DACP Report ─────────────────────────────────────────────────────────────

function generateDACPReport() {
  const leads = db.prepare(
    `SELECT l.*, c.name as contact_name, c.email as contact_email, c.title as contact_title, c.phone as contact_phone
     FROM le_leads l LEFT JOIN le_contacts c ON l.id = c.lead_id
     WHERE l.tenant_id = 'dacp-construction-001'
     ORDER BY l.priority_score DESC`
  ).all();

  const contacts = db.prepare(
    `SELECT c.*, l.venue_name
     FROM le_contacts c JOIN le_leads l ON c.lead_id = l.id
     WHERE c.tenant_id = 'dacp-construction-001'
     ORDER BY l.priority_score DESC`
  ).all();

  const bidCount = db.prepare(`SELECT COUNT(*) as cnt FROM dacp_bid_requests WHERE tenant_id='dacp-construction-001'`).get().cnt;
  const estCount = db.prepare(`SELECT COUNT(*) as cnt FROM dacp_estimates WHERE tenant_id='dacp-construction-001'`).get().cnt;
  const totalBid = db.prepare(`SELECT SUM(total_bid) as total FROM dacp_estimates WHERE tenant_id='dacp-construction-001'`).get().total;

  // Cover page
  const coverPage = [
    emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(),
    emptyLine(), emptyLine(),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: 'DACP CONSTRUCTION', bold: true, size: 52, color: NAVY, font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { before: 80, after: 40 },
      children: [new TextRun({ text: 'GC Contact Intelligence Report', bold: true, size: 36, color: NAVY, font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: 'March 2026', size: 24, color: GRAY, font: 'Calibri' })],
    }),
    emptyLine(),
    new Paragraph({
      children: [new TextRun({ text: 'CONFIDENTIAL', smallCaps: true, size: 22, color: RED, font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { before: 40 },
      children: [new TextRun({ text: 'Powered by Coppice', size: 18, color: GRAY, font: 'Calibri' })],
    }),
    pageBreak(),
  ];

  // Executive Summary
  const execSummary = [
    heading1('Executive Summary', NAVY),
    body(
      "Coppice's Lead Engine identified 6 active construction projects across the Houston/DFW metro. " +
      'Apollo enrichment verified 6 decision-maker contacts at major general contractors including Turner Construction, ' +
      'DPR, Hensel Phelps, and Skanska. This report provides the complete pipeline with contact details and recommended outreach strategy.'
    ),
    emptyLine(),
    twoColTable([
      ['Active Leads', '6'],
      ['Verified Contacts', '6'],
      ['GCs with Relationship', '6'],
      ['Bid Requests Active', String(bidCount)],
      ['Estimates Completed', String(estCount)],
      ['Total Pipeline Value', `~$${(totalBid / 1000).toFixed(0)}K`],
    ], NAVY),
    pageBreak(),
  ];

  // Priority Leads
  function recommendationText(status) {
    if (status === 'contacted') return 'Follow up on submitted bid. Schedule call to discuss scope.';
    if (status === 'responded') return 'Strong signal. Prepare partnership proposal for next meeting.';
    return 'Initial outreach recommended. Send capability statement.';
  }

  const priorityLeads = [heading1('Priority Leads', NAVY)];
  for (const lead of leads) {
    priorityLeads.push(
      heading2(`${lead.venue_name}`, NAVY),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              headerCell('Location', NAVY),
              headerCell('Industry', NAVY),
              headerCell('Priority', NAVY),
              headerCell('Status', NAVY),
            ],
          }),
          new TableRow({
            children: [
              dataCell(lead.region || 'Texas'),
              dataCell(lead.industry),
              dataCell(String(lead.priority_score)),
              dataCell(lead.status),
            ],
          }),
        ],
      }),
      bodyRuns([
        { text: 'Key Contact: ', bold: true },
        { text: `${lead.contact_name}, ${lead.contact_title} — ${lead.contact_email}` },
      ]),
      body(recommendationText(lead.status), { italics: true }),
      separator(),
    );
  }
  priorityLeads.push(pageBreak());

  // Contact Directory
  const contactDir = [
    heading1('Contact Directory', NAVY),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ['GC', 'Contact', 'Title', 'Email', 'Phone', 'Verified'].map(h => headerCell(h, NAVY)),
        }),
        ...contacts.map((c, i) => {
          const shade = i % 2 === 0 ? WHITE : LIGHT_GRAY;
          return new TableRow({
            children: [
              dataCell(c.venue_name, shade),
              dataCell(c.name, shade),
              dataCell(c.title, shade),
              dataCell(c.email, shade),
              dataCell(c.phone, shade),
              dataCell(c.mx_valid ? 'Yes' : 'No', shade),
            ],
          });
        }),
      ],
    }),
    pageBreak(),
  ];

  // Outreach Strategy
  const outreach = [
    heading1('Recommended Outreach Strategy', NAVY),
    body('The following 3-week sequence maximizes response rates while maintaining a professional cadence:'),
    emptyLine(),
    numberedParagraph(1, 'Week 1: Send personalized emails to top 3 priority contacts'),
    numberedParagraph(2, 'Week 2: Follow-up emails to non-responders + phone calls'),
    numberedParagraph(3, 'Week 3: Send capability statement package to remaining leads'),
    emptyLine(),
    body('Draft emails are available for review in the Coppice dashboard at dacp.coppice.ai', { italics: true }),
    pageBreak(),
  ];

  // Next Steps
  const nextSteps = [
    heading1('Next Steps', NAVY),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ['Action', 'Owner', 'Target Date'].map(h => headerCell(h, NAVY)),
        }),
        ...([
          ['Review and approve outreach emails', 'Marcel', 'March 12'],
          ['Send estimates to Turner and Rogers-O\'Brien', 'Coppice Agent', 'March 13'],
          ['Schedule follow-up cycle', 'Coppice Agent', 'March 17'],
          ['Run next discovery cycle', 'Coppice Agent', 'March 17'],
        ]).map(([action, owner, date], i) => {
          const shade = i % 2 === 0 ? WHITE : LIGHT_GRAY;
          return new TableRow({
            children: [dataCell(action, shade), dataCell(owner, shade), dataCell(date, shade)],
          });
        }),
      ],
    }),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
      },
    },
    sections: [
      {
        properties: makeDocProps(NAVY),
        footers: makeFooter('DACP Construction'),
        children: [
          ...coverPage,
          ...execSummary,
          ...priorityLeads,
          ...contactDir,
          ...outreach,
          ...nextSteps,
        ],
      },
    ],
  });

  return doc;
}

// ── Sangha Report ───────────────────────────────────────────────────────────

function generateSanghaReport() {
  const totalLeads = db.prepare(`SELECT COUNT(*) as cnt FROM le_leads WHERE tenant_id='default'`).get().cnt;
  const totalContacts = db.prepare(`SELECT COUNT(*) as cnt FROM le_contacts WHERE tenant_id='default'`).get().cnt;
  const verifiedContacts = db.prepare(`SELECT COUNT(*) as cnt FROM le_contacts WHERE tenant_id='default' AND mx_valid=1`).get().cnt;
  const outreachCount = db.prepare(`SELECT COUNT(*) as cnt FROM le_outreach_log WHERE tenant_id='default'`).get().cnt;
  const categories = db.prepare(`SELECT COUNT(DISTINCT industry) as cnt FROM le_leads WHERE tenant_id='default'`).get().cnt;

  // Top 10 leads with first contact
  const top10 = db.prepare(
    `SELECT l.id, l.venue_name, l.region, l.industry, l.trigger_news, l.priority_score, l.status
     FROM le_leads l
     WHERE l.tenant_id='default'
     ORDER BY l.priority_score DESC LIMIT 10`
  ).all();

  // All contacts grouped
  const allContacts = db.prepare(
    `SELECT c.*, l.venue_name, l.industry
     FROM le_contacts c JOIN le_leads l ON c.lead_id = l.id
     WHERE c.tenant_id='default'
     ORDER BY l.industry, l.venue_name, c.name`
  ).all();

  // Outreach emails
  const outreachEmails = db.prepare(
    `SELECT o.*, c.name as contact_name, c.email as contact_email
     FROM le_outreach_log o
     LEFT JOIN le_contacts c ON o.contact_id = c.id
     WHERE o.tenant_id='default'
     ORDER BY o.created_at`
  ).all();

  // Cover page
  const coverPage = [
    emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(),
    emptyLine(), emptyLine(),
    new Paragraph({
      children: [new TextRun({ text: 'SANGHA RENEWABLES', bold: true, size: 52, color: GREEN, font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { before: 80, after: 40 },
      children: [new TextRun({ text: 'Partner Intelligence Report', bold: true, size: 36, color: GREEN, font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: 'March 2026', size: 24, color: GRAY, font: 'Calibri' })],
    }),
    emptyLine(),
    new Paragraph({
      children: [new TextRun({ text: 'CONFIDENTIAL', smallCaps: true, size: 22, color: RED, font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { before: 40 },
      children: [new TextRun({ text: 'Powered by Coppice', size: 18, color: GRAY, font: 'Calibri' })],
    }),
    pageBreak(),
  ];

  // Executive Summary
  const execSummary = [
    heading1('Executive Summary', GREEN),
    body(
      "Coppice's Lead Engine discovered 65 potential partners across 6 categories: Bitcoin miners, solar IPPs, " +
      'wind developers, data centers, renewable IPPs, and insurance companies. Apollo enrichment verified ' +
      `${verifiedContacts} decision-maker contacts including CEOs and VPs at CleanSpark, Core Scientific, ` +
      'Riot Platforms, Crusoe, TotalEnergies, Invenergy, and more.'
    ),
    emptyLine(),
    twoColTable([
      ['Total Leads', String(totalLeads)],
      ['Verified Contacts', String(verifiedContacts)],
      ['Lead Categories', String(categories)],
      ['Outreach Drafts', String(outreachCount)],
      ['Top Region', 'ERCOT'],
    ], GREEN),
    pageBreak(),
  ];

  // Priority Targets
  function pitchText(industry) {
    if (industry === 'Bitcoin Miner') return 'Revenue assurance via hash price insurance — guaranteed minimum IRR on mining operations';
    if (industry === 'Solar IPP' || industry === 'Wind IPP' || industry === 'Renewable IPP' || industry === 'Wind/Solar')
      return 'Behind-the-meter co-location to monetize curtailed generation';
    if (industry === 'Data Center') return 'Powered land with guaranteed energy availability at competitive rates';
    return 'Strategic partnership for energy optimization and revenue protection';
  }

  const priorityTargets = [heading1('Priority Targets', GREEN)];
  for (const lead of top10) {
    // Get first contact for this lead
    const contact = db.prepare(
      `SELECT name, email, title FROM le_contacts WHERE lead_id=? LIMIT 1`
    ).get(lead.id);

    const triggerShort = lead.trigger_news
      ? (lead.trigger_news.split(';')[0].trim().substring(0, 200))
      : '';

    priorityTargets.push(
      heading2(lead.venue_name, GREEN),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ['Type', 'Region', 'Priority', 'Status'].map(h => headerCell(h, GREEN)),
          }),
          new TableRow({
            children: [
              dataCell(lead.industry),
              dataCell(lead.region),
              dataCell(String(lead.priority_score)),
              dataCell(lead.status),
            ],
          }),
        ],
      }),
    );

    if (triggerShort) {
      priorityTargets.push(
        bodyRuns([
          { text: 'Trigger: ', bold: true },
          { text: triggerShort, italics: true, size: 20 },
        ]),
      );
    }

    if (contact) {
      priorityTargets.push(
        bodyRuns([
          { text: 'Key Contact: ', bold: true },
          { text: `${contact.name}${contact.title ? ', ' + contact.title : ''} — ${contact.email}` },
        ]),
      );
    }

    priorityTargets.push(
      bodyRuns([
        { text: 'Recommended Pitch: ', bold: true },
        { text: pitchText(lead.industry), italics: true },
      ]),
      separator(),
    );
  }
  priorityTargets.push(pageBreak());

  // Contact Directory — grouped by industry
  const contactDirSections = [heading1('Contact Directory', GREEN)];
  const grouped = {};
  for (const c of allContacts) {
    const key = c.industry || 'Other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }

  for (const [industry, grpContacts] of Object.entries(grouped)) {
    contactDirSections.push(heading2(industry, GREEN));
    contactDirSections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ['Company', 'Name', 'Title', 'Email', 'Verified', 'Source'].map(h => headerCell(h, GREEN)),
          }),
          ...grpContacts.map((c, i) => {
            const shade = i % 2 === 0 ? WHITE : LIGHT_GRAY;
            return new TableRow({
              children: [
                dataCell(c.venue_name, shade),
                dataCell(c.name, shade),
                dataCell(c.title, shade),
                dataCell(c.email, shade),
                dataCell(c.mx_valid ? 'Yes' : 'No', shade),
                dataCell(c.source, shade),
              ],
            });
          }),
        ],
      }),
    );
    contactDirSections.push(emptyLine());
  }
  contactDirSections.push(pageBreak());

  // Outreach Strategy — show actual drafts
  const outreachSection = [
    heading1('Outreach Strategy', GREEN),
    body('Below are the drafted outreach emails generated by Coppice. All outreach is written in Spencer\'s voice.'),
    emptyLine(),
  ];

  for (const email of outreachEmails) {
    outreachSection.push(
      new Paragraph({
        spacing: { before: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: GREEN, space: 2 } },
        children: [new TextRun({ text: `Email: ${email.email_type === 'initial' ? 'Initial Outreach' : 'Follow-up'}`, bold: true, size: 22, color: GREEN, font: 'Calibri' })],
      }),
      bodyRuns([
        { text: 'To: ', bold: true },
        { text: `${email.contact_name || ''} <${email.contact_email || ''}>` },
      ]),
      bodyRuns([
        { text: 'Subject: ', bold: true },
        { text: email.subject || '' },
      ]),
      bodyRuns([
        { text: 'Status: ', bold: true },
        { text: email.status || 'draft' },
      ]),
      emptyLine(),
    );

    // Body lines
    const bodyLines = (email.body || '').split('\n');
    for (const line of bodyLines) {
      outreachSection.push(
        new Paragraph({
          spacing: { after: 40 },
          indent: { left: 400 },
          children: [new TextRun({ text: line, size: 20, font: 'Calibri', color: DARK_GRAY, italics: true })],
        }),
      );
    }
    outreachSection.push(separator());
  }
  outreachSection.push(pageBreak());

  // Next Steps
  const nextSteps = [
    heading1('Next Steps', GREEN),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ['Action', 'Owner', 'Target Date'].map(h => headerCell(h, GREEN)),
        }),
        ...([
          ['Approve outreach to CleanSpark and Core Scientific', 'Spencer', 'March 12'],
          ['Run next discovery cycle for MISO/PJM targets', 'Coppice Agent', 'March 17'],
          ['Schedule calls with responded leads (Meridian, GridScale, Apex)', 'Spencer', 'March 14'],
        ]).map(([action, owner, date], i) => {
          const shade = i % 2 === 0 ? WHITE : LIGHT_GRAY;
          return new TableRow({
            children: [dataCell(action, shade), dataCell(owner, shade), dataCell(date, shade)],
          });
        }),
      ],
    }),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
      },
    },
    sections: [
      {
        properties: makeDocProps(GREEN),
        footers: makeFooter('Sangha Renewables'),
        children: [
          ...coverPage,
          ...execSummary,
          ...priorityTargets,
          ...contactDirSections,
          ...outreachSection,
          ...nextSteps,
        ],
      },
    ],
  });

  return doc;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Generating DACP report...');
  const dacpDoc = generateDACPReport();
  const dacpBuf = await Packer.toBuffer(dacpDoc);
  const dacpPath = path.join(OUT_DIR, 'DACP_GC_Contacts_Report_Mar2026.docx');
  writeFileSync(dacpPath, dacpBuf);
  console.log(`  -> ${dacpPath} (${(dacpBuf.length / 1024).toFixed(1)} KB)`);

  console.log('Generating Sangha report...');
  const sanghaDoc = generateSanghaReport();
  const sanghaBuf = await Packer.toBuffer(sanghaDoc);
  const sanghaPath = path.join(OUT_DIR, 'Sangha_IPP_Contact_Report_Mar2026.docx');
  writeFileSync(sanghaPath, sanghaBuf);
  console.log(`  -> ${sanghaPath} (${(sanghaBuf.length / 1024).toFixed(1)} KB)`);

  // Update tenant_files table
  const dbw = new Database(DB_PATH);
  const insert = dbw.prepare(
    `INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  insert.run(
    'tf-dacp-gc-report-mar2026',
    'dacp-construction-001',
    'DACP_GC_Contacts_Report_Mar2026.docx',
    'leads',
    'docx',
    dacpBuf.length,
  );

  insert.run(
    'tf-sangha-ipp-report-mar2026',
    'default',
    'Sangha_IPP_Contact_Report_Mar2026.docx',
    'leads',
    'docx',
    sanghaBuf.length,
  );

  dbw.close();
  console.log('tenant_files table updated.');
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
