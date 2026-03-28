import { google } from 'googleapis';
import { readFileSync } from 'fs';

const tokenData = JSON.parse(readFileSync(process.env.HOME + '/gmail_token_zhan.json', 'utf-8'));
const oauth2 = new google.auth.OAuth2(tokenData.client_id, tokenData.client_secret);
oauth2.setCredentials({ refresh_token: tokenData.refresh_token, access_token: tokenData.access_token });
const gmail = google.gmail({ version: 'v1', auth: oauth2 });

const boundary = `boundary_${Date.now()}`;
const pdf1 = readFileSync('/tmp/SE1_BTM_Analysis_Project_Odin.pdf').toString('base64');
const pdf2 = readFileSync('/tmp/Odin_DD_Research_7Point.pdf').toString('base64');

const htmlBody = `<p>Hey Teo,</p>
<p>Two reports attached for review:</p>
<ol>
<li><strong>Project Odin SE1 BTM Analysis (Corrected)</strong> — the corrected feasibility report replacing the SE2 analysis. Covers SE1 power market, energy tax, AI compute angle, grid infrastructure, FCR, risk matrix, DD questions. Updated with tighter formatting.</li>
<li><strong>Project Odin 7-Point Site Assessment</strong> — Mo's DD research workbook. All 7 topics researched with findings, DD questions for EIP, and red flags per topic. Ready to be turned into the Excel worksheet Mo mentioned.</li>
</ol>
<p>Let me know if the formatting and content look good before sending to Spencer/Mo.</p>`;

const htmlBase64 = Buffer.from(htmlBody).toString('base64');

const raw = [
  'From: teo@zhan.capital',
  'To: teo@zhan.capital',
  'Subject: Project Odin - Both Reports for Review (Corrected Analysis + DD Research)',
  'MIME-Version: 1.0',
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
  '',
  `--${boundary}`,
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  htmlBase64,
  `--${boundary}`,
  'Content-Type: application/pdf; name="Project_Odin_SE1_BTM_Analysis_Corrected.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="Project_Odin_SE1_BTM_Analysis_Corrected.pdf"',
  '',
  pdf1,
  `--${boundary}`,
  'Content-Type: application/pdf; name="Project_Odin_DD_Research_7Point.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="Project_Odin_DD_Research_7Point.pdf"',
  '',
  pdf2,
  `--${boundary}--`,
].join('\r\n');

const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
console.log('Sent! Message ID:', result.data.id);
