/**
 * Send a test IPP inquiry email from teo@volt-charging.com to agent@sangha.coppice.ai
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Load Volt Charging credentials
const tokenData = JSON.parse(readFileSync(join(homedir(), 'Charger-Bot/gmail_token.json'), 'utf-8'));

const oauth2Client = new google.auth.OAuth2(
  tokenData.client_id,
  tokenData.client_secret,
  'http://localhost:8099'
);
oauth2Client.setCredentials({ refresh_token: tokenData.refresh_token });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const to = 'agent@sangha.coppice.ai';
const subject = 'IPP Inquiry -- 85 MW Solar Farm in West Texas, Behind-the-Meter Mining';
const body = `Hi Sangha team,

We're reaching out regarding a potential behind-the-meter mining opportunity at our solar facility in West Texas.

Here are the key specs for the site:

- Facility: Pecos Valley Solar Farm
- Location: Pecos County, Texas (ERCOT West zone)
- Nameplate Capacity: 85 MW
- Annual Generation: 195,000 MWh
- Generation Hours: ~2,300 hrs/year
- Current Curtailment Rate: 22%
- Average Nodal Price: $28.50/MWh

We're currently selling 100% to grid but losing significant revenue during curtailment windows. We've heard co-locating bitcoin miners behind the meter can monetize that wasted energy.

Would love to see what the economics look like for our site — mine size sensitivity, deal value, all-in electricity costs, etc.

Happy to share hourly generation data as a CSV if that helps refine the analysis.

Best regards,
Teo Blind
VP of Energy, Volt Charging
teo@volt-charging.com`;

function encodeSubject(s) {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`;
}

const headers = [
  `From: Teo Blind <teo@volt-charging.com>`,
  `To: ${to}`,
  `Subject: ${encodeSubject(subject)}`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
];

const rawMessage = [...headers, '', body].join('\r\n');
const encodedMessage = Buffer.from(rawMessage)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

try {
  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });
  console.log(`Email sent from teo@volt-charging.com to ${to}`);
  console.log(`Message ID: ${result.data.id}`);
  console.log('\nThe Gmail poller will pick this up within ~1 minute and run the IPP pipeline.');
  console.log('Check VPS logs: pm2 logs coppice-backend --lines 30');
} catch (err) {
  console.error('Send failed:', err.message);
}
