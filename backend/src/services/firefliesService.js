/**
 * Fireflies.ai Integration Service
 *
 * Fetches meeting transcripts from the Fireflies.ai GraphQL API.
 * API key stored in key_vault as service='fireflies', key_name='api_key'.
 */

import { getKeyVaultValue } from '../cache/database.js';

const FIREFLIES_API = 'https://api.fireflies.ai/graphql';

// ─── URL Parsing ────────────────────────────────────────────────────────────

/**
 * Extract the transcript ID from a Fireflies URL.
 * URL format: https://app.fireflies.ai/view/{slug}::{ID}?ref=...
 * Returns the ID portion (after ::, before ?) or null if not a valid URL.
 */
export function extractFirefliesMeetingId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('fireflies.ai')) return null;
    // pathname like /view/Sangha-EIP-discuss-Nysater::01KMB36A3VX3ZM6H4J3FS5PJ8E
    const match = parsed.pathname.match(/::([A-Za-z0-9]+)$/);
    return match ? match[1] : null;
  } catch {
    // Try raw regex if URL constructor fails
    const match = url.match(/fireflies\.ai\/view\/[^:]+::([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }
}

// ─── GraphQL Helpers ────────────────────────────────────────────────────────

function getApiKey(tenantId) {
  const key = getKeyVaultValue(tenantId, 'fireflies', 'api_key');
  if (!key) {
    console.warn(`[Fireflies] No API key found for tenant ${tenantId}`);
  }
  return key;
}

async function gqlRequest(apiKey, query, variables = {}) {
  const resp = await fetch(FIREFLIES_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Fireflies API ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Fireflies GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
  }
  return json.data;
}

// ─── Transcript Fetching ────────────────────────────────────────────────────

const TRANSCRIPT_QUERY = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      date
      duration
      speakers {
        id
        name
      }
      sentences {
        index
        speaker_name
        text
        start_time
        end_time
      }
      summary {
        overview
        action_items
        keywords
        short_summary
        topics_discussed
      }
      meeting_attendees {
        displayName
        email
      }
    }
  }
`;

/**
 * Fetch a single transcript by ID.
 * Returns { raw, formatted, summary, actionItems, speakers } or null on failure.
 */
export async function fetchFirefliesTranscript(tenantId, meetingId) {
  const apiKey = getApiKey(tenantId);
  if (!apiKey) return null;

  try {
    const data = await gqlRequest(apiKey, TRANSCRIPT_QUERY, { transcriptId: meetingId });
    const transcript = data?.transcript;
    if (!transcript) {
      console.warn(`[Fireflies] No transcript found for ID ${meetingId}`);
      return null;
    }

    const formatted = formatTranscriptAsMarkdown(transcript);
    const summary = transcript.summary || {};

    return {
      raw: transcript,
      formatted,
      summary: {
        overview: summary.overview || null,
        shortSummary: summary.short_summary || null,
        keywords: summary.keywords || [],
        topicsDiscussed: summary.topics_discussed || null,
      },
      actionItems: summary.action_items || [],
      speakers: (transcript.speakers || []).map(s => s.name),
    };
  } catch (e) {
    console.warn(`[Fireflies] Failed to fetch transcript ${meetingId}:`, e.message);
    return null;
  }
}

// ─── Search / List Transcripts ──────────────────────────────────────────────

const SEARCH_QUERY = `
  query Transcripts($keyword: String, $fromDate: DateTime, $toDate: DateTime, $limit: Int) {
    transcripts(
      keyword: $keyword
      from_date: $fromDate
      to_date: $toDate
      limit: $limit
    ) {
      id
      title
      date
      duration
      meeting_attendees {
        displayName
        email
      }
      summary {
        short_summary
        keywords
      }
    }
  }
`;

/**
 * Search / list transcripts.
 * Options: { keyword, fromDate (ISO string), toDate (ISO string), limit (default 20) }
 * Returns array of transcript summaries or null on failure.
 */
export async function searchFirefliesTranscripts(tenantId, { keyword, fromDate, toDate, limit = 20 } = {}) {
  const apiKey = getApiKey(tenantId);
  if (!apiKey) return null;

  try {
    const variables = { limit };
    if (keyword) variables.keyword = keyword;
    if (fromDate) variables.fromDate = fromDate;
    if (toDate) variables.toDate = toDate;

    const data = await gqlRequest(apiKey, SEARCH_QUERY, variables);
    return data?.transcripts || [];
  } catch (e) {
    console.warn(`[Fireflies] Search failed:`, e.message);
    return null;
  }
}

// ─── Markdown Formatting ────────────────────────────────────────────────────

function formatTimestamp(seconds) {
  if (seconds == null || isNaN(seconds)) return '??:??';
  const totalSec = Math.round(Number(seconds));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDate(dateVal) {
  if (!dateVal) return 'Unknown';
  try {
    // Fireflies returns epoch ms or ISO string
    const d = typeof dateVal === 'number' ? new Date(dateVal) : new Date(dateVal);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return String(dateVal);
  }
}

function formatDuration(durationSeconds) {
  if (!durationSeconds) return 'Unknown';
  const mins = Math.round(Number(durationSeconds) / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Convert a Fireflies transcript API response into readable markdown.
 */
export function formatTranscriptAsMarkdown(transcript) {
  if (!transcript) return '';

  const lines = [];
  const { title, date, duration, meeting_attendees, summary, sentences } = transcript;

  // Header
  lines.push(`## Meeting: ${title || 'Untitled'}`);
  lines.push(`**Date**: ${formatDate(date)} | **Duration**: ${formatDuration(duration)}`);

  // Attendees
  if (meeting_attendees?.length) {
    const names = meeting_attendees.map(a => {
      const name = a.displayName || 'Unknown';
      return a.email ? `${name} (${a.email})` : name;
    });
    lines.push(`**Attendees**: ${names.join(', ')}`);
  }
  lines.push('');

  // Summary
  if (summary?.overview || summary?.short_summary) {
    lines.push('### Summary');
    lines.push(summary.overview || summary.short_summary);
    lines.push('');
  }

  // Action Items
  if (summary?.action_items?.length) {
    lines.push('### Action Items');
    for (const item of summary.action_items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // Key Topics
  if (summary?.topics_discussed) {
    lines.push('### Key Topics');
    lines.push(summary.topics_discussed);
    lines.push('');
  }

  // Keywords
  if (summary?.keywords?.length) {
    lines.push(`**Keywords**: ${summary.keywords.join(', ')}`);
    lines.push('');
  }

  // Full Transcript
  if (sentences?.length) {
    lines.push('### Full Transcript');
    for (const s of sentences) {
      const speaker = s.speaker_name || 'Unknown';
      const ts = formatTimestamp(s.start_time);
      lines.push(`**${speaker}** (${ts}): ${s.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
