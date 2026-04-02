/**
 * Google Meet REST API Service
 *
 * Manages meeting space access settings to allow Recall.ai bots
 * to join without waiting room admission.
 *
 * Flow: Before bot joins, set space accessType to OPEN.
 *       After bot is in_call, restore to TRUSTED.
 *
 * Requires OAuth scope: https://www.googleapis.com/auth/meetings.space.created
 */

import { google } from 'googleapis';

// ─── Config ──────────────────────────────────────────────────────────────────

let _clientPairs = null;
function getClientPairs() {
  if (!_clientPairs) {
    _clientPairs = [
      { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
      { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET },
    ].filter(p => p.id && p.secret);
  }
  return _clientPairs;
}

/**
 * Extract the meeting code from a Google Meet URL.
 * e.g. "https://meet.google.com/abc-defg-hjk" -> "abc-defg-hjk"
 *      "https://meet.google.com/abc-defg-hjk?authuser=0" -> "abc-defg-hjk"
 */
export function extractMeetingCode(meetUrl) {
  if (!meetUrl) return null;
  const match = meetUrl.match(/meet\.google\.com\/([a-z\-]+)/);
  return match ? match[1] : null;
}

/**
 * Get an OAuth2 client with the given refresh token.
 */
function makeOAuth2(refreshToken) {
  const pairs = getClientPairs();
  if (!refreshToken || pairs.length === 0) return null;
  const client = new google.auth.OAuth2(pairs[0].id, pairs[0].secret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Set the meeting space access type.
 * @param {string} refreshToken - OAuth refresh token for the meeting organizer
 * @param {string} meetingCode - The meeting code (e.g. "abc-defg-hjk")
 * @param {string} accessType - "OPEN" or "TRUSTED"
 * @returns {boolean} true if successful
 */
export async function setSpaceAccess(refreshToken, meetingCode, accessType) {
  if (!meetingCode || !refreshToken) return false;

  const auth = makeOAuth2(refreshToken);
  if (!auth) return false;

  try {
    const { token } = await auth.getAccessToken();
    if (!token) {
      console.warn('[GoogleMeet] Failed to get access token');
      return false;
    }

    const spaceName = `spaces/${meetingCode}`;
    const res = await fetch(
      `https://meet.googleapis.com/v2/${spaceName}?updateMask=config.accessType`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: { accessType },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[GoogleMeet] Failed to set ${accessType} on ${meetingCode}: ${res.status} ${body}`);
      return false;
    }

    console.log(`[GoogleMeet] Set ${meetingCode} accessType=${accessType}`);
    return true;
  } catch (err) {
    console.warn(`[GoogleMeet] Error setting access on ${meetingCode}: ${err.message}`);
    return false;
  }
}

/**
 * Open a meeting space for bot entry, then restore after bot joins.
 * Call this before creating the Recall.ai bot.
 *
 * @param {string} refreshToken - OAuth refresh token for the organizer
 * @param {string} meetUrl - Full Google Meet URL
 * @returns {boolean} true if meeting was opened successfully
 */
export async function openForBotEntry(refreshToken, meetUrl) {
  const code = extractMeetingCode(meetUrl);
  if (!code) return false;
  return setSpaceAccess(refreshToken, code, 'OPEN');
}

/**
 * Restore meeting to trusted access after bot has joined.
 *
 * @param {string} refreshToken - OAuth refresh token for the organizer
 * @param {string} meetUrl - Full Google Meet URL
 * @returns {boolean} true if successful
 */
export async function restoreAccess(refreshToken, meetUrl) {
  const code = extractMeetingCode(meetUrl);
  if (!code) return false;
  return setSpaceAccess(refreshToken, code, 'TRUSTED');
}
