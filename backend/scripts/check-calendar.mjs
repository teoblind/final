import { getTenantDb } from "../src/cache/database.js";
import { google } from "googleapis";

const db = getTenantDb("sangha-renewables");
const rt = db.prepare("SELECT key_value FROM key_vault WHERE tenant_id = ? AND service = ? AND key_name = ?").get("sangha-renewables", "google-calendar", "refresh_token");
if (!rt) { console.log("No calendar refresh token"); process.exit(); }

const clients = [
  { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
  { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET },
];

for (const c of clients) {
  if (!c.id) continue;
  try {
    const oauth = new google.auth.OAuth2(c.id, c.secret);
    oauth.setCredentials({ refresh_token: rt.key_value });
    const calendar = google.calendar({ version: "v3", auth: oauth });
    const now = new Date();
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date(now.getTime() - 120 * 60000).toISOString(),
      timeMax: new Date(now.getTime() + 120 * 60000).toISOString(),
      singleEvents: true,
    });
    const items = res.data.items || [];
    console.log("Client " + c.id.slice(-8) + ": " + items.length + " events");
    for (const e of items) {
      console.log(" - " + e.summary + " | " + (e.hangoutLink || "no-link") + " | org: " + (e.organizer?.email || "?"));
    }
    break;
  } catch (e) {
    console.log("Client " + (c.id?.slice(-8) || "?") + " failed: " + e.message?.slice(0, 100));
  }
}
