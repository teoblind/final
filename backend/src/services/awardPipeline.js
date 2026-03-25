/**
 * Award Notice Pipeline
 *
 * Detects job award emails from GCs and processes them:
 * 1. Matches to existing bid request / estimate
 * 2. Creates a job entry in dacp_jobs
 * 3. Updates bid request status to 'awarded'
 * 4. Drafts a confirmation reply (queued for approval in copilot mode)
 */

import { randomUUID } from 'crypto';
import {
  getDacpBidRequests, getDacpEstimate, updateDacpBidRequest,
  createDacpJob, insertApprovalItem, insertActivity, getAgentMode,
} from '../cache/database.js';
import { tunnelPrompt } from './cliTunnel.js';
import { markdownToEmailHtml } from './emailService.js';

const DEFAULT_TENANT_ID = 'dacp-construction-001';

// ─── Classifier ────────────────────────────────────────────────────────────────

const AWARD_SUBJECT_KEYWORDS = [
  'award', 'awarded', 'selected', 'notice of award',
  'letter of intent', 'loi', 'notice to proceed', 'ntp',
];

const AWARD_BODY_KEYWORDS = [
  'pleased to inform', 'pleased to notify',
  'you have been selected', 'been awarded',
  'award this project', 'award the contract',
  'subcontractor agreement', 'notice of award',
  'letter of intent', 'notice to proceed',
  'execute the subcontract', 'signed subcontract',
  'insurance certificates', 'certificate of insurance',
  'mobilization schedule', 'pre-construction meeting',
  'pre-construction kickoff', 'kickoff meeting',
  'selected your firm', 'selected as the',
  'accepted your bid', 'accepted your proposal',
  'moving forward with your', 'proceed with your',
];

const ANTI_AWARD_KEYWORDS = [
  'submit your bid', 'request for quote', 'request for pricing',
  'please bid', 'invitation to bid', 'bid due date',
  'we have not yet awarded', 'has not been awarded',
];

export function isAwardNotice(subject, body) {
  const subjectLower = (subject || '').toLowerCase();
  const bodyLower = (body || '').toLowerCase();

  // Check for anti-keywords first
  const antiHits = ANTI_AWARD_KEYWORDS.filter(kw => bodyLower.includes(kw));
  if (antiHits.length > 0) return false;

  const hasSubjectKeyword = AWARD_SUBJECT_KEYWORDS.some(kw => subjectLower.includes(kw));
  const bodyHits = AWARD_BODY_KEYWORDS.filter(kw => bodyLower.includes(kw));

  // Subject keyword + at least 1 body keyword, OR 3+ body keywords alone
  return (hasSubjectKeyword && bodyHits.length >= 1) || bodyHits.length >= 3;
}

// ─── Bid Request Matching ──────────────────────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/^(re|fwd|fw|rfq|rfp|itb):\s*/gi, '')
    .replace(/\s*-\s*(award|notice|selected|loi|ntp).*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

function findMatchingBidRequest(tenantId, senderEmail, subject) {
  const allBids = getDacpBidRequests(tenantId);
  if (!allBids.length) return null;

  const normalizedSubject = normalize(subject);
  const subjectWords = new Set(normalizedSubject.split(/\s+/).filter(w => w.length > 3));

  const scored = allBids.map(bid => {
    let score = 0;
    // Email match is a strong signal
    if (bid.from_email && bid.from_email.toLowerCase() === senderEmail.toLowerCase()) score += 10;
    // Subject word overlap
    const bidSubject = normalize(bid.subject || bid.project_name || '');
    const bidWords = bidSubject.split(/\s+/).filter(w => w.length > 3);
    const overlap = bidWords.filter(w => subjectWords.has(w)).length;
    score += overlap;
    // Project name overlap
    const projName = normalize(bid.project_name || '');
    const projWords = projName.split(/\s+/).filter(w => w.length > 3);
    score += projWords.filter(w => subjectWords.has(w)).length;
    return { bid, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 2 ? scored[0].bid : null;
}

// ─── Process Award ─────────────────────────────────────────────────────────────

export async function processAwardNotice({ messageId, threadId, from, fromName, subject, body, tenantId = DEFAULT_TENANT_ID }) {
  console.log(`[AwardPipeline] Processing award: "${subject}" from ${fromName || from}`);

  // 1. Match to existing bid request
  const bidRequest = findMatchingBidRequest(tenantId, from, subject);
  const gcName = fromName || bidRequest?.gc_name || from;
  const projectName = bidRequest?.project_name || normalize(subject);

  // 2. Find associated estimate
  let estimate = null;
  if (bidRequest?.id) {
    const estimates = getDacpBidRequests(tenantId); // get all to find linked estimate
    // Look for estimate linked to this bid
    try {
      const { getDacpEstimates } = await import('../cache/database.js');
      const allEstimates = getDacpEstimates(tenantId);
      estimate = allEstimates.find(e => e.bid_request_id === bidRequest.id);
    } catch {}
  }

  // 3. Check if already awarded (prevent duplicates)
  if (bidRequest?.status === 'awarded') {
    console.log(`[AwardPipeline] Bid ${bidRequest.id} already awarded — logging activity only`);
    insertActivity({
      tenantId, type: 'in',
      title: `Duplicate award notice from ${gcName}`,
      subtitle: subject,
      detailJson: JSON.stringify({ from, fromName, subject, body: body.slice(0, 2000), bidId: bidRequest.id }),
      sourceType: 'email', sourceId: messageId, agentId: 'estimating',
    });
    return { jobId: null, gcName, duplicate: true };
  }

  // 4. Create job entry
  const jobId = `JOB-${randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    createDacpJob({
      id: jobId,
      tenant_id: tenantId,
      estimate_id: estimate?.id || null,
      project_name: projectName,
      gc_name: gcName,
      project_type: bidRequest?.project_type || 'concrete',
      location: bidRequest?.location || null,
      status: 'pending',
      bid_amount: estimate?.totalBid || null,
      margin_pct: estimate?.margin_pct || null,
      notes: `Awarded via email from ${gcName} on ${new Date().toISOString().slice(0, 10)}`,
    });
    console.log(`[AwardPipeline] Created job ${jobId} for "${projectName}"`);
  } catch (err) {
    console.error(`[AwardPipeline] Job creation failed:`, err.message);
  }

  // 5. Update bid request status
  if (bidRequest?.id) {
    updateDacpBidRequest(tenantId, bidRequest.id, { status: 'awarded' });
    console.log(`[AwardPipeline] Bid ${bidRequest.id} status → awarded`);
  }

  // 6. Log inbound activity
  insertActivity({
    tenantId, type: 'in',
    title: `Job awarded by ${gcName}`,
    subtitle: `${projectName} — ${estimate ? '$' + estimate.totalBid?.toLocaleString() : 'amount TBD'}`,
    detailJson: JSON.stringify({
      from, fromName, subject, body: body.slice(0, 5000),
      jobId, bidId: bidRequest?.id, estimateId: estimate?.id,
    }),
    sourceType: 'email', sourceId: messageId, agentId: 'estimating',
  });

  // 7. Draft confirmation reply
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  let agentResponse = '';

  try {
    const draftPrompt = [
      `You are drafting a reply to a GC who just awarded DACP Construction a job. Write a professional confirmation email.`,
      `\nAward email from ${gcName}:\n---\n${body.slice(0, 3000)}\n---`,
      `\nProject: ${projectName}`,
      estimate ? `Bid amount: $${estimate.totalBid?.toLocaleString()}` : '',
      `\nYour reply should:`,
      `- Thank them and confirm receipt of the award`,
      `- Confirm readiness to proceed`,
      `- Mention you will provide updated insurance certificates`,
      `- Ask about pre-construction meeting scheduling if not already mentioned`,
      `- Be concise and professional — 3-4 paragraphs max`,
      `- Do NOT include any sign-off, signature block, or closing name — the email system will automatically append the correct Coppice signature`,
      `\nReturn ONLY the email body text. No subject line, no headers, no signature.`,
    ].filter(Boolean).join('\n');

    agentResponse = await tunnelPrompt({
      tenantId,
      agentId: 'estimating',
      prompt: draftPrompt,
      maxTurns: 3,
      timeoutMs: 60_000,
      label: 'Award Confirmation Draft',
    });
  } catch (err) {
    console.error(`[AwardPipeline] Draft generation failed:`, err.message);
    agentResponse = `Thank you for the award notice on the ${projectName} project. We confirm receipt and are ready to proceed.\n\nWe will provide updated insurance certificates shortly. Please let us know the pre-construction meeting schedule.`;
  }

  // 8. Queue for approval (copilot) or send directly
  const isCopilot = getAgentMode('estimating') === 'copilot';
  const html = markdownToEmailHtml(agentResponse);

  const approvalPayload = {
    to: from,
    subject: replySubject,
    html,
    body: agentResponse,
    tenantId,
    threadId,
    inReplyTo: messageId,
    references: messageId,
    bidId: bidRequest?.id || null,
    estimateId: estimate?.id || null,
    jobId,
    totalBid: estimate?.totalBid || null,
    awardConfirmation: true,
  };

  if (isCopilot) {
    insertApprovalItem({
      tenantId,
      agentId: 'estimating',
      title: `Confirm award: ${projectName} from ${gcName}`,
      description: `Reply to award notice for "${projectName}" — Job ${jobId} created`,
      type: 'email_draft',
      payloadJson: JSON.stringify(approvalPayload),
    });

    insertActivity({
      tenantId, type: 'out',
      title: `Award confirmation drafted (pending approval)`,
      subtitle: `${projectName} — Job ${jobId}`,
      detailJson: JSON.stringify({ jobId, bidId: bidRequest?.id, to: from }),
      sourceType: 'email', agentId: 'estimating',
    });

    console.log(`[AwardPipeline] Confirmation draft queued for approval — Job ${jobId}`);
  } else {
    // Auto-send
    try {
      const { sendEmail } = await import('./emailService.js');
      await sendEmail({
        to: from, subject: replySubject, body: agentResponse,
        tenantId, threadId, inReplyTo: messageId, references: messageId,
      });
      insertActivity({
        tenantId, type: 'out',
        title: `Award confirmation sent to ${gcName}`,
        subtitle: `${projectName} — Job ${jobId}`,
        detailJson: JSON.stringify({ jobId, bidId: bidRequest?.id, to: from }),
        sourceType: 'email', agentId: 'estimating',
      });
      console.log(`[AwardPipeline] Confirmation sent to ${from}`);
    } catch (err) {
      console.error(`[AwardPipeline] Email send failed:`, err.message);
    }
  }

  return { jobId, gcName, projectName, bidId: bidRequest?.id, estimateId: estimate?.id };
}
