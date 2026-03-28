const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const ERCOT_FOLDER = "1OFFn-5yCYiCFG8R4Q0KEaS8R0b25JNa0";

async function main() {
  // Step 1: Use service account to share folder with sangha agent
  const saAuth = new google.auth.GoogleAuth({
    keyFile: "/Users/teoblind/google-service-account.json",
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  const saDrive = google.drive({ version: "v3", auth: saAuth });

  // Delete the empty NYISO folder created by mistake
  try {
    await saDrive.files.delete({ fileId: "1lhUTJj7hNDblJo5pJXcDtlATqae6wvpE" });
    console.log("Deleted empty NYISO folder (service account one)");
  } catch(e) { console.log("Delete skip:", e.message); }

  // Share ERCOT Data folder with sangha agent
  try {
    await saDrive.permissions.create({
      fileId: ERCOT_FOLDER,
      requestBody: { role: "writer", type: "user", emailAddress: "agent@sangha.coppice.ai" },
      sendNotificationEmail: false
    });
    console.log("Shared ERCOT Data folder with agent@sangha.coppice.ai");
  } catch(e) { console.log("Share:", e.message); }

  // Step 2: Use sangha agent to create NYISO folder and upload
  const token = JSON.parse(fs.readFileSync("/Users/teoblind/sangha_agent_token.json", "utf8"));
  const oauth2 = new google.auth.OAuth2(token.client_id, token.client_secret);
  oauth2.setCredentials({ refresh_token: token.refresh_token, access_token: token.access_token });
  const agentDrive = google.drive({ version: "v3", auth: oauth2 });

  // Create NYISO subfolder
  const folderMeta = await agentDrive.files.create({
    requestBody: {
      name: "NYISO LMP Data (Zones, 2014-2026)",
      mimeType: "application/vnd.google-apps.folder",
      parents: [ERCOT_FOLDER]
    },
    fields: "id, webViewLink"
  });
  const folderId = folderMeta.data.id;
  console.log("Created NYISO folder:", folderMeta.data.webViewLink);

  // Combine daily CSVs into yearly and upload
  const zoneDir = "/Users/teoblind/Desktop/NYISO_PJM_LMP/NYISO/zones";
  const files = fs.readdirSync(zoneDir).filter(f => f.endsWith(".csv")).sort();
  console.log("Total daily files:", files.length);

  const yearlyData = {};
  let header = null;
  for (const file of files) {
    const year = file.substring(0, 4);
    if (!yearlyData[year]) yearlyData[year] = [];
    const content = fs.readFileSync(path.join(zoneDir, file), "utf-8");
    const lines = content.trim().split("\n");
    if (!header) header = lines[0];
    yearlyData[year].push(yearlyData[year].length === 0 ? lines.join("\n") : lines.slice(1).join("\n"));
  }

  const years = Object.keys(yearlyData).sort();
  console.log("Years:", years.join(", "));

  for (const year of years) {
    const combined = yearlyData[year].join("\n");
    const tmpFile = `/tmp/nyiso_zone_lmp_${year}.csv`;
    fs.writeFileSync(tmpFile, combined.startsWith(header) ? combined : header + "\n" + combined);
    const size = fs.statSync(tmpFile).size;
    console.log(`Uploading ${year}... (${(size / 1024 / 1024).toFixed(1)} MB)`);

    await agentDrive.files.create({
      requestBody: { name: `NYISO_Zone_LMP_${year}.csv`, parents: [folderId] },
      media: { mimeType: "text/csv", body: fs.createReadStream(tmpFile) },
      fields: "id, name"
    });
    console.log(`  ${year} done`);
    fs.unlinkSync(tmpFile);
  }

  // Also delete the orphan NYISO folder from sangha agent's root
  try {
    await agentDrive.files.delete({ fileId: "1s5ofLSJEmWszkCoC12vm3hAxePawSRlH" });
    console.log("Deleted orphan NYISO folder from agent root");
  } catch(e) { console.log("Orphan delete:", e.message); }

  console.log("\nDone! Folder:", folderMeta.data.webViewLink);
}
main().catch(err => console.error(err.message));
