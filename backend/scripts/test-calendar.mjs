import 'dotenv/config';
import { google } from 'googleapis';
import { getTenantDb, getAllTenants } from '../src/cache/database.js';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

const tenants = getAllTenants();

for (const t of tenants) {
  console.log(`\n=== ${t.id} ===`);
  let rows;
  try {
    const tdb = getTenantDb(t.id);
    rows = tdb.prepare('SELECT * FROM tenant_email_config').all();
  } catch {
    console.log('  No email config table');
    continue;
  }
  if (rows.length === 0) {
    console.log('  No email configs');
    continue;
  }

  for (const row of rows) {
    console.log(`  Agent: ${row.sender_email}`);
    const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    auth.setCredentials({ refresh_token: row.gmail_refresh_token });
    const cal = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

    try {
      const res = await cal.events.list({
        calendarId: 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = res.data.items || [];
      console.log(`  Events today: ${events.length}`);
      for (const e of events) {
        const link = e.hangoutLink || e.conferenceData?.entryPoints?.[0]?.uri || null;
        console.log(`    - "${e.summary}" at ${e.start?.dateTime || e.start?.date}`);
        console.log(`      Organizer: ${e.organizer?.email}`);
        console.log(`      Meet link: ${link || 'NONE'}`);
        console.log(`      Attendees: ${(e.attendees || []).map(a => a.email).join(', ')}`);
      }
    } catch (err) {
      console.log(`  Calendar API ERROR: ${err.message}`);
    }
  }
}
