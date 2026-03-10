import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Search, ExternalLink, ChevronRight, ChevronDown, FolderOpen, RefreshCw, Send, Mail, X, AlertTriangle, TrendingUp, Shield, Target, Zap, Clock, FileText, Printer, Download, MessageCircle } from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../auth/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const FILE_BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3002' : '';

// ─── File Type Icons ────────────────────────────────────────────────────────

const FILE_ICONS = {
  doc:    { letter: 'D', bg: '#e8eef5', color: '#2c5282' },
  docx:   { letter: 'D', bg: '#e8eef5', color: '#2c5282' },
  sheet:  { letter: 'S', bg: '#edf7f0', color: '#1a6b3c' },
  xlsx:   { letter: 'S', bg: '#edf7f0', color: '#1a6b3c' },
  slides: { letter: 'P', bg: '#fdf6e8', color: '#b8860b' },
  pptx:   { letter: 'P', bg: '#fdf6e8', color: '#b8860b' },
  pdf:    { letter: 'F', bg: '#fdedf0', color: '#dc3545' },
  csv:    { letter: 'C', bg: '#edf7f0', color: '#1a6b3c' },
  other:  { letter: '?', bg: '#f5f4f0', color: '#666' },
};

function getFileIcon(fileType) {
  return FILE_ICONS[fileType] || FILE_ICONS.other;
}

// Google Drive icon SVG
function DriveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" className="inline-block">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.85 10.15z" fill="#ea4335"/>
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h36.85c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5 60.65 3.3c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.25 28h27.5c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

// ─── Intel Report Content ───────────────────────────────────────────────────

const REPORT_CONTENT = {
  '2026-02-06': `\u26a1 Weekly Intel: Feb 6, 2026 \u2013 Mining Market Dynamics
============================================================
Generated: Feb 6, 2026 2:03 PM EST

COMPETITOR SNAPSHOT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Key Competitor Actions (Last 24-72 Hours):



Trending Themes:
\u2022 mining_difficulty_decline [new]
\u2022 industry_consolidation [new]
\u2022 cost_advantage_critical [new]



Our Positioning: Competitive landscape stable - continue monitoring for emerging opportunities.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

TOP NEWS ITEMS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500


1. Bitfarms Deleverages, Unveils Keel Rebrand as Bitcoin Mining Margins Sink Below $30/PH/s - TheMinerMag
   [credible] [near_term] [high] [opportunity]

   Why it matters: Major miner financial distress and potential capacity reduction will decrease network difficulty, improving margins for remaining efficient operators.
   Sangha impact: Bitfarms' struggles indicate industry consolidation opportunity. Their potential hashrate reduction directly benefits Sangha through lower difficulty. Distressed assets may become available at attractive prices.
   Actionability: Monitor Bitfarms for potential asset acquisition opportunities or facility partnerships


2. Bitcoin miners power down en masse as losses hit records - ForkLog
   [credible] [near_term] [high] [opportunity]

   Why it matters: Widespread miner shutdowns reduce network hashrate and mining difficulty, making remaining operations more profitable per unit of computing power deployed.
   Sangha impact: As competitors shut down operations, Bitcoin mining difficulty will decrease, directly improving Sangha's profit margins per hash. Sangha's low-cost behind-the-meter advantage becomes even more critical as higher-cost miners exit first.
   Actionability: Monitor hashrate data to quantify opportunity and use in investor materials to highlight competitive moat


3. Bitcoin Is Crashing So Hard That Miners Are Unplugging Their Equipment - Futurism
   [credible] [near_term] [high] [opportunity]

   Why it matters: Bitcoin price crash forcing miner shutdowns validates the importance of low-cost energy as the primary competitive moat in mining operations.
   Sangha impact: Sangha's behind-the-meter model with sub-3-cent power provides crucial margin buffer that keeps operations profitable even as competitors shut down, strengthening long-term market position.
   Actionability: Use current market conditions to demonstrate model resilience in investor conversations`,

  '2026-02-02': `\u26a1 Weekly Intel: Feb 2, 2026 \u2013 Mining Market Dynamics
============================================================
Generated: Feb 2, 2026 8:37 PM EST

COMPETITOR SNAPSHOT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Key Competitor Actions (Last 24-72 Hours):
\u2022 CleanSpark (CLSK): CleanSpark is expanding data center operations in Texas beyond Bitcoin mining to diversify revenue streams.
  Strategic Read: Competitor diversification in Sangha's key geographic market could impact utility relationship development.
  Risk: CleanSpark expanding in Texas could compete for the same utility partnerships and behind-the-meter opportunities that are core to Sangha's Texas pipeline growth strategy.
  Sangha Implication: CleanSpark's Texas data center push may compete for the same utility partnerships and behind-the-meter sites Sangha targets. However, their split focus between mining and data centers creates opportunities for Sangha to secure pure mining partnerships with utilities seeking dedicated Bitcoin mining load.

\u2022 Bitdeer (BTDR): Bitdeer Technologies faces divided Wall Street analyst opinions despite potential upside, indicating market uncertainty about their strategy.
  Strategic Read: Market uncertainty around Bitdeer suggests lack of clear strategic direction compared to focused competitors.
  Sangha Implication: Bitdeer's unclear strategic direction and divided analyst sentiment suggests they may struggle to compete effectively against Sangha's focused pure-play mining strategy. This creates opportunities for Sangha to capture market share and investor confidence in the Bitcoin mining space.

\u2022 Riot Platforms (RIOT): Riot Platforms entered into a lease agreement with AMD to pivot portions of their operations toward AI data center revenues.
  Strategic Read: Major Bitcoin miner pivoting to AI/HPC represents reduced competition in pure-play mining space.
  Sangha Implication: Riot's pivot away from Bitcoin mining will reduce network difficulty over time, directly increasing Sangha's mining profitability and margins. This validates Sangha's pure-play mining strategy.


Trending Themes:
\u2022 AI infrastructure pivot trend
\u2022 Texas market competition
\u2022 Mining industry consolidation


Our Positioning: Mixed signals - competitors diversifying away from mining opens opportunities, but Texas market competition intensifying.`,

  '2026-01-29': `\u26a1 Weekly Intel: Jan 29, 2026 \u2013 Mining Market Dynamics
============================================================
Generated: Jan 29, 2026 8:49 PM EST

COMPETITOR SNAPSHOT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Key Moves (Last 24-72 Hours):
\u2022 Cipher Mining (CIFR): Cipher Mining Turns To AI And Cloud With Amazon AWS Deal - simplywall.st
  Strategic Read: Cipher Mining securing breakthrough cloud partnership with Amazon AWS, accessing massive enterprise AI market through premier hyperscaler.
  Sangha Implication: Cipher Mining securing breakthrough cloud partnership with Amazon AWS, accessing massive enterprise AI market through premier hyperscaler.

\u2022 Hut 8 (HUT): Assessing Hut 8 (HUT) Valuation As AI Infrastructure Pivot Attracts Fresh Institutional Interest - simplywall.st
  Strategic Read: Hut 8's AI infrastructure pivot attracting fresh institutional investment interest, showing successful repositioning strategy.
  Sangha Implication: Hut 8's AI infrastructure pivot attracting fresh institutional investment interest, showing successful repositioning strategy.

\u2022 TeraWulf (WULF): TeraWulf Texas HPC Pivot Recasts Bitcoin Miner As AI Infrastructure Play - simplywall.st
  Strategic Read: TeraWulf establishing Texas HPC operations for AI workloads, competing directly in key geographic and technology markets.
  Sangha Implication: TeraWulf establishing Texas HPC operations for AI workloads, competing directly in key geographic and technology markets.

\u2022 CleanSpark (CLSK): CleanSpark Texas Land Move Puts AI Data Center Ambitions In Focus - simplywall.st
  Strategic Read: CleanSpark expanding into Texas with AI data center focus, entering key geographic market with dual-use infrastructure strategy.
  Sangha Implication: CleanSpark expanding into Texas with AI data center focus, entering key geographic market with dual-use infrastructure strategy.

\u2022 Riot Platforms (RIOT): Riot Platforms Recasts Bitcoin Mining Story With AMD AI Data Center Deal - Yahoo Finance
  Strategic Read: Riot securing major AI infrastructure partnership with AMD, diversifying beyond pure Bitcoin mining into high-growth AI data center market.
  Sangha Implication: Riot securing major AI infrastructure partnership with AMD, diversifying beyond pure Bitcoin mining into high-growth AI data center market.


Trending Themes:
\u2022 Grid stability and demand response
\u2022 Mining industry consolidation
\u2022 AI and data center integration
\u2022 Bitcoin miner to AI infrastructure pivot


Our Positioning: Competitive pressure increasing - several moves require strategic response.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

TOP NEWS ITEMS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500


1. Grid reliability projected to decline as data centers drive demand, watchdog says - The Hill
   [credible] [near_term] [high] [risk]

   Why it matters: Growing data center demand threatening grid reliability could trigger regulatory responses affecting all large-load consumers including mining operations.
   Sangha impact: Could result in stricter interconnection requirements or load limitations that impact expansion plans. Behind-the-meter model provides natural hedge against grid-level regulatory changes.
   Actionability: Track NERC and ERCOT policy discussions on data center interconnection rules`,
};

// ─── Report Parser & Modal ──────────────────────────────────────────────────

const TAG_COLORS = {
  credible:    { bg: '#edf7f0', text: '#1a6b3c', border: '#d0e8d8' },
  near_term:   { bg: '#fdf6e8', text: '#b8860b', border: '#f0e0b0' },
  high:        { bg: '#fdedf0', text: '#dc3545', border: '#f0c5cc' },
  risk:        { bg: '#fdedf0', text: '#dc3545', border: '#f0c5cc' },
  opportunity: { bg: '#e8eef5', text: '#2c5282', border: '#c5d5e8' },
  new:         { bg: '#f3eef8', text: '#5b3a8c', border: '#d8cce8' },
};

function parseReport(raw) {
  if (!raw) return null;

  const lines = raw.split('\n');
  const report = {
    title: '',
    generated: '',
    competitorSnapshot: {
      keyMoves: [],
      themes: [],
      positioning: '',
    },
    newsItems: [],
  };

  // Extract title (first non-empty line)
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.match(/^[=\u2500]+$/)) {
      report.title = trimmed.replace(/^\u26a1\s*/, '');
      break;
    }
  }

  // Extract generated date
  const genMatch = raw.match(/Generated:\s*(.+)/);
  if (genMatch) report.generated = genMatch[1].trim();

  // Find sections by looking for the dividers
  const sectionBreak = '\u2500'.repeat(40);

  // Parse competitor snapshot section
  const compStart = raw.indexOf('COMPETITOR SNAPSHOT');
  const newsStart = raw.indexOf('TOP NEWS ITEMS');

  if (compStart !== -1) {
    const compEnd = newsStart !== -1 ? newsStart : raw.length;
    const compSection = raw.substring(compStart, compEnd);

    // Extract competitor bullet points
    const bulletRegex = /\u2022\s+(.+?)(?=\n\u2022|\nTrending Themes|\nOur Positioning|\n\u2500|$)/gs;
    let match;
    while ((match = bulletRegex.exec(compSection)) !== null) {
      const block = match[1].trim();
      const tickerMatch = block.match(/^(.+?)\s*\(([A-Z]+)\):\s*/);
      const competitor = {
        name: tickerMatch ? tickerMatch[1] : '',
        ticker: tickerMatch ? tickerMatch[2] : '',
        headline: '',
        strategicRead: '',
        sanghaImplication: '',
        risk: '',
      };

      const rest = tickerMatch ? block.substring(tickerMatch[0].length) : block;
      // Check if it's a theme line (no colon fields)
      if (!rest.includes('Strategic Read:') && !rest.includes('Sangha Implication:') && !rest.includes('Risk:')) {
        // It's a trending theme, skip
        continue;
      }

      // Split into headline and fields
      const srIdx = rest.indexOf('Strategic Read:');
      const siIdx = rest.indexOf('Sangha Implication:');
      const riskIdx = rest.indexOf('Risk:');

      if (srIdx !== -1) {
        competitor.headline = rest.substring(0, srIdx).trim();
        const srEnd = riskIdx !== -1 && riskIdx > srIdx ? riskIdx : (siIdx !== -1 ? siIdx : rest.length);
        competitor.strategicRead = rest.substring(srIdx + 'Strategic Read:'.length, srEnd).trim();
      } else {
        competitor.headline = rest.trim();
      }

      if (riskIdx !== -1) {
        const rEnd = siIdx !== -1 && siIdx > riskIdx ? siIdx : rest.length;
        competitor.risk = rest.substring(riskIdx + 'Risk:'.length, rEnd).trim();
      }

      if (siIdx !== -1) {
        competitor.sanghaImplication = rest.substring(siIdx + 'Sangha Implication:'.length).trim();
      }

      if (competitor.name || competitor.headline) {
        report.competitorSnapshot.keyMoves.push(competitor);
      }
    }

    // Extract trending themes
    const themesMatch = compSection.match(/Trending Themes:\n([\s\S]*?)(?=\n\nOur Positioning|\n\u2500|$)/);
    if (themesMatch) {
      const themeLines = themesMatch[1].split('\n').filter(l => l.trim().startsWith('\u2022'));
      report.competitorSnapshot.themes = themeLines.map(l => {
        const text = l.replace(/^\u2022\s*/, '').trim();
        const tagMatch = text.match(/\[([^\]]+)\]/);
        return { text: text.replace(/\s*\[[^\]]+\]\s*/g, '').trim(), tag: tagMatch ? tagMatch[1] : null };
      });
    }

    // Extract positioning
    const posMatch = compSection.match(/Our Positioning:\s*(.+)/);
    if (posMatch) report.competitorSnapshot.positioning = posMatch[1].trim();
  }

  // Parse news items
  if (newsStart !== -1) {
    const newsSection = raw.substring(newsStart);
    const itemRegex = /(\d+)\.\s+(.+?)(?:\n\s+Source:[^\n]*)?(?:\n\s+(\[.+?\]))\n([\s\S]*?)(?=\n\d+\.\s|\n\u2500|$)/g;
    let newsMatch;
    while ((newsMatch = itemRegex.exec(newsSection)) !== null) {
      const num = parseInt(newsMatch[1]);
      const headline = newsMatch[2].trim();
      const tagsStr = newsMatch[3] || '';
      const body = newsMatch[4].trim();

      // Parse tags
      const tags = [];
      const tagRegex = /\[([^\]]+)\]/g;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(tagsStr)) !== null) {
        tags.push(tagMatch[1]);
      }

      // Parse fields from body
      const whyMatch = body.match(/Why it matters:\s*([\s\S]*?)(?=\n\s+Sangha impact:|$)/);
      const sanghaMatch = body.match(/Sangha impact:\s*([\s\S]*?)(?=\n\s+Actionability:|$)/);
      const actionMatch = body.match(/Actionability:\s*([\s\S]*?)$/);

      // Extract source from headline
      const sourceMatch = headline.match(/\s*-\s*([^-]+)$/);
      const source = sourceMatch ? sourceMatch[1].trim() : '';
      const cleanHeadline = sourceMatch ? headline.substring(0, headline.lastIndexOf(' - ')).trim() : headline;

      report.newsItems.push({
        number: num,
        headline: cleanHeadline,
        source,
        tags,
        whyItMatters: whyMatch ? whyMatch[1].trim() : '',
        sanghaImpact: sanghaMatch ? sanghaMatch[1].trim() : '',
        actionability: actionMatch ? actionMatch[1].trim() : '',
      });
    }
  }

  return report;
}

function TagBadge({ tag }) {
  const key = tag.toLowerCase().replace(/\s+/g, '_');
  const colors = TAG_COLORS[key] || { bg: '#f5f4f0', text: '#666', border: '#e5e5e0' };
  return (
    <span
      className="inline-flex items-center px-2 py-[2px] rounded-full text-[10px] font-bold uppercase tracking-[0.5px]"
      style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
    >
      {tag}
    </span>
  );
}

// ─── Report Comments ────────────────────────────────────────────────────────

const REACTION_EMOJIS = ['👍', '🔥', '⚠️'];

function ReportCommentsSection({ reportId }) {
  const { user, tokens } = useAuth();
  const [comments, setComments] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const [mentionUsers, setMentionUsers] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const authHeaders = tokens?.accessToken
    ? { Authorization: `Bearer ${tokens.accessToken}` }
    : {};

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch {}
  }, [reportId]);

  // Initial fetch + 30s polling
  useEffect(() => {
    fetchComments();
    const interval = setInterval(fetchComments, 30000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  // Fetch users for @mention
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}/users`, { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          setMentionUsers(data.users || []);
        }
      } catch {}
    })();
  }, [reportId]);

  // Auto-scroll on new comments
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handlePost = async () => {
    if (!newMessage.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setComments(prev => [...prev, data.comment]);
        setNewMessage('');
      }
    } catch {}
    setPosting(false);
  };

  const handleReact = async (commentId, emoji) => {
    try {
      const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}/${commentId}/react`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const data = await res.json();
        setComments(prev => prev.map(c => c.id === commentId ? data.comment : c));
      }
    } catch {}
  };

  const insertMention = (userName) => {
    const cursorPos = inputRef.current?.selectionStart || newMessage.length;
    const textBefore = newMessage.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx >= 0) {
      const before = newMessage.slice(0, atIdx);
      const after = newMessage.slice(cursorPos);
      setNewMessage(`${before}@${userName} ${after}`);
    }
    setShowMentions(false);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setNewMessage(val);
    // Check for @mention trigger
    const cursorPos = e.target.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || textBefore[atIdx - 1] === ' ')) {
      const query = textBefore.slice(atIdx + 1);
      if (!query.includes(' ')) {
        setMentionFilter(query.toLowerCase());
        setShowMentions(true);
        return;
      }
    }
    setShowMentions(false);
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const formatTime = (dateStr) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now - d;
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      const diffDays = Math.floor(diffHrs / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  // Highlight @mentions in message text
  const renderMessage = (text) => {
    const parts = text.split(/(@\w+(?:\s\w+)?)/g);
    return parts.map((part, i) =>
      part.startsWith('@')
        ? <span key={i} style={{ color: '#2c5282', fontWeight: 600 }}>{part}</span>
        : part
    );
  };

  const INITIALS_COLORS = ['#2c5282', '#1a6b3c', '#5b3a8c', '#b8860b', '#dc3545', '#0d9488'];
  const getColor = (name) => {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length];
  };

  const filteredMentions = mentionUsers.filter(u =>
    u.name.toLowerCase().includes(mentionFilter)
  );

  // If no auth (demo mode), show placeholder
  if (!user) {
    return (
      <div style={{ borderTop: '1px solid #e8e8e3', padding: '16px 32px', background: '#fff' }}>
        <div className="flex items-center gap-2" style={{ color: '#999', fontSize: '12px' }}>
          <MessageCircle size={14} />
          <span>Sign in to comment on this report</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid #e8e8e3', background: '#fff' }}>
      {/* Section header */}
      <div className="flex items-center gap-2 px-8 pt-4 pb-2">
        <MessageCircle size={14} style={{ color: '#999' }} />
        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#999' }}>
          Team Discussion
        </span>
        {comments.length > 0 && (
          <span style={{ fontSize: '10px', fontWeight: 600, color: '#fff', background: '#1a2e1a', borderRadius: '10px', padding: '1px 7px', minWidth: '18px', textAlign: 'center' }}>
            {comments.length}
          </span>
        )}
      </div>

      {/* Comments list */}
      <div ref={scrollRef} style={{ maxHeight: '240px', overflowY: 'auto', padding: '0 32px' }}>
        {comments.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: '#999', fontSize: '12px', fontStyle: 'italic' }}>
            No comments yet. Start the discussion.
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {comments.map(comment => {
              const color = getColor(comment.user_name);
              return (
                <div key={comment.id} className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: color + '18', color }}
                  >
                    <span style={{ fontSize: '10px', fontWeight: 700 }}>{getInitials(comment.user_name)}</span>
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a' }}>{comment.user_name}</span>
                      <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', color: '#999', background: '#f5f4f0', padding: '1px 5px', borderRadius: '3px' }}>
                        {comment.user_role}
                      </span>
                      <span style={{ fontSize: '10px', color: '#bbb' }}>{formatTime(comment.created_at)}</span>
                    </div>
                    <p style={{ fontSize: '13px', color: '#333', lineHeight: 1.5, margin: 0 }}>
                      {renderMessage(comment.message)}
                    </p>
                    {/* Reactions */}
                    <div className="flex items-center gap-1 mt-1.5">
                      {REACTION_EMOJIS.map(emoji => {
                        const reacted = (comment.reactions?.[emoji] || []).includes(user.id);
                        const count = (comment.reactions?.[emoji] || []).length;
                        return (
                          <button
                            key={emoji}
                            onClick={() => handleReact(comment.id, emoji)}
                            className="flex items-center gap-1 transition-all"
                            style={{
                              fontSize: '12px', padding: '1px 6px', borderRadius: '12px',
                              background: reacted ? '#e8eef5' : 'transparent',
                              border: count > 0 ? '1px solid #e8e8e3' : '1px solid transparent',
                              cursor: 'pointer', opacity: count > 0 ? 1 : 0.4,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#f5f4f0'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = count > 0 ? '1' : '0.4'; e.currentTarget.style.background = reacted ? '#e8eef5' : 'transparent'; }}
                          >
                            <span>{emoji}</span>
                            {count > 0 && <span style={{ fontSize: '10px', fontWeight: 600, color: '#666' }}>{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="relative px-8 py-3" style={{ borderTop: '1px solid #f0eeea' }}>
        {/* @mention dropdown */}
        {showMentions && filteredMentions.length > 0 && (
          <div
            className="absolute bottom-full left-8 right-8 mb-1 rounded-lg shadow-lg overflow-hidden"
            style={{ background: '#fff', border: '1px solid #e8e8e3', zIndex: 10 }}
          >
            {filteredMentions.slice(0, 5).map(u => (
              <button
                key={u.id}
                onClick={() => insertMention(u.name.split(' ')[0])}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{ fontSize: '12px' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f5f4f0'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: getColor(u.name) + '18', color: getColor(u.name), fontSize: '9px', fontWeight: 700 }}
                >
                  {getInitials(u.name)}
                </div>
                <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{u.name}</span>
                <span style={{ color: '#999', fontSize: '10px' }}>{u.role}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: getColor(user.name) + '18', color: getColor(user.name) }}
          >
            <span style={{ fontSize: '9px', fontWeight: 700 }}>{getInitials(user.name)}</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
            placeholder="Add a comment... (use @ to mention)"
            style={{
              flex: 1, fontSize: '13px', padding: '8px 12px', borderRadius: '10px',
              border: '1px solid #e8e8e3', background: '#fafaf8', outline: 'none',
              fontFamily: "'DM Sans', sans-serif",
            }}
            onFocus={e => { e.target.style.borderColor = '#2dd478'; }}
            onBlur={e => { e.target.style.borderColor = '#e8e8e3'; }}
          />
          <button
            onClick={handlePost}
            disabled={!newMessage.trim() || posting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors"
            style={{
              fontSize: '11px', fontWeight: 600, color: '#fff', background: '#1a2e1a',
              opacity: !newMessage.trim() || posting ? 0.4 : 1,
              cursor: !newMessage.trim() || posting ? 'default' : 'pointer',
            }}
          >
            <Send size={11} />
            Post
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportViewerModal({ file, onClose }) {
  const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
  const dateKey = dateMatch ? dateMatch[1] : null;
  const rawContent = dateKey ? REPORT_CONTENT[dateKey] : null;
  const report = parseReport(rawContent);
  const [toast, setToast] = useState(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Inject Google Fonts
  useEffect(() => {
    if (!document.querySelector('link[data-intel-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.intelFonts = '1';
      link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleExport = useCallback(() => {
    if (file.url) {
      window.open(file.url, '_blank', 'noopener,noreferrer');
      showToast('Opened in Google Docs');
    }
  }, [file.url, showToast]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Derive sentiment from positioning text
  const getSentimentTags = (report) => {
    if (!report) return [];
    const pos = report.competitorSnapshot.positioning.toLowerCase();
    const tags = [];
    if (pos.includes('opportunit') || pos.includes('open')) tags.push({ label: 'Opportunity', color: '#2c5282', bg: '#e8eef5' });
    if (pos.includes('stable') || pos.includes('advantage')) tags.push({ label: 'Bullish', color: '#1a6b3c', bg: '#edf7f0' });
    if (pos.includes('pressure') || pos.includes('intensif') || pos.includes('competitive')) tags.push({ label: 'Bearish', color: '#dc3545', bg: '#fdedf0' });
    if (pos.includes('mixed') || pos.includes('signal')) tags.push({ label: 'Mixed Signals', color: '#b8860b', bg: '#fdf6e8' });
    if (pos.includes('neutral') || pos.includes('monitor')) tags.push({ label: 'Neutral', color: '#666', bg: '#f5f4f0' });
    if (tags.length === 0) tags.push({ label: 'Monitoring', color: '#666', bg: '#f5f4f0' });
    return tags;
  };

  // Derive stats from report content
  const getStats = (report) => {
    if (!report) return [];
    const moves = report.competitorSnapshot.keyMoves.length;
    const news = report.newsItems.length;
    const themes = report.competitorSnapshot.themes.length;
    return [
      { value: moves, label: 'Competitor Moves' },
      { value: news, label: 'News Items' },
      { value: themes, label: 'Trending Themes' },
    ];
  };

  if (!report) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white rounded-2xl p-8 text-center max-w-md" onClick={e => e.stopPropagation()} style={{ fontFamily: "'DM Sans', sans-serif" }}>
          <p className="text-terminal-muted text-sm">Report content not available.</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg bg-[#1a2e1a] text-white text-sm font-semibold">Close</button>
        </div>
      </div>
    );
  }

  const sentimentTags = getSentimentTags(report);
  const stats = getStats(report);
  const positioningIsPositive = report.competitorSnapshot.positioning.toLowerCase().includes('stable') ||
    report.competitorSnapshot.positioning.toLowerCase().includes('opportunit');
  const positioningIsNegative = report.competitorSnapshot.positioning.toLowerCase().includes('pressure') ||
    report.competitorSnapshot.positioning.toLowerCase().includes('intensif');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-[900px] mx-4 my-6 max-h-[calc(100vh-48px)] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ fontFamily: "'DM Sans', sans-serif", background: '#fafaf8' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ─── Header ─── */}
        <div className="shrink-0 px-8 py-6" style={{ background: 'linear-gradient(135deg, #1a2e1a 0%, #1d3a1d 100%)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(45, 212, 120, 0.15)' }}>
                  <Zap size={16} style={{ color: '#2dd478' }} />
                </div>
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", fontWeight: 500, letterSpacing: '1.5px', color: 'rgba(45, 212, 120, 0.7)', textTransform: 'uppercase' }}>
                  Intelligence Report
                </span>
              </div>
              <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '26px', fontWeight: 400, color: '#fff', lineHeight: 1.2, marginBottom: '8px' }}>
                {report.title}
              </h2>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', fontFamily: "'DM Mono', monospace" }}>
                  <Clock size={10} />
                  {report.generated}
                </span>
                <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(45, 212, 120, 0.12)', color: '#2dd478', border: '1px solid rgba(45, 212, 120, 0.2)' }}>
                  Intelligence Agent
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ color: 'rgba(255,255,255,0.4)', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={18} />
            </button>
          </div>

          {/* ─── Sentiment Strip ─── */}
          <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", fontWeight: 500, letterSpacing: '1px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
              Sentiment
            </span>
            {sentimentTags.map((tag, i) => (
              <span
                key={i}
                style={{
                  fontSize: '10px', fontWeight: 600, padding: '2px 10px', borderRadius: '20px',
                  background: tag.bg, color: tag.color, letterSpacing: '0.3px',
                }}
              >
                {tag.label}
              </span>
            ))}
          </div>
        </div>

        {/* ─── Stats Row ─── */}
        <div className="shrink-0 grid gap-0 border-b" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)`, borderColor: '#e8e8e3' }}>
          {stats.map((stat, i) => (
            <div
              key={i}
              className="flex flex-col items-center justify-center py-4"
              style={{
                background: '#fff',
                borderRight: i < stats.length - 1 ? '1px solid #e8e8e3' : 'none',
              }}
            >
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '28px', fontWeight: 500, color: '#1a2e1a', lineHeight: 1 }}>
                {stat.value}
              </span>
              <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#999', marginTop: '4px' }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">

          {/* ─── Competitor Snapshot ─── */}
          <section>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#f3eef8' }}>
                <Shield size={14} style={{ color: '#5b3a8c' }} />
              </div>
              <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                Competitor Snapshot
              </h3>
            </div>

            {report.competitorSnapshot.keyMoves.length > 0 ? (
              <div className="space-y-3">
                {report.competitorSnapshot.keyMoves.map((move, i) => (
                  <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                    <div className="px-5 py-4">
                      <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#e8eef5' }}>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', fontWeight: 500, color: '#2c5282' }}>
                            {move.ticker || '?'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{move.name}</span>
                            {move.ticker && (
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: '#999', background: '#f5f4f0', padding: '1px 6px', borderRadius: '4px' }}>
                                {move.ticker}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: 1.6, marginBottom: '10px' }}>{move.headline}</p>
                          {move.strategicRead && (
                            <div style={{ marginBottom: '8px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2c5282' }}>Strategic Read</span>
                              <p style={{ fontSize: '12px', color: '#666', lineHeight: 1.6, marginTop: '2px' }}>{move.strategicRead}</p>
                            </div>
                          )}
                          {move.risk && (
                            <div style={{ marginBottom: '8px', padding: '8px 12px', background: '#fef8f8', borderRadius: '8px', borderLeft: '3px solid #dc3545' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#dc3545' }}>Risk</span>
                              <p style={{ fontSize: '12px', color: '#666', lineHeight: 1.6, marginTop: '2px' }}>{move.risk}</p>
                            </div>
                          )}
                          {move.sanghaImplication && (
                            <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: '8px', borderLeft: '3px solid #1a6b3c' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1a6b3c' }}>Sangha Implication</span>
                              <p style={{ fontSize: '12px', color: '#666', lineHeight: 1.6, marginTop: '2px' }}>{move.sanghaImplication}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                <p style={{ fontSize: '13px', color: '#999', fontStyle: 'italic' }}>No significant competitor moves in the last 24-72 hours.</p>
              </div>
            )}

            {/* Trending Themes */}
            {report.competitorSnapshot.themes.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#999', display: 'block', marginBottom: '8px' }}>
                  Trending Themes
                </span>
                <div className="flex flex-wrap gap-2">
                  {report.competitorSnapshot.themes.map((theme, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5"
                      style={{
                        padding: '6px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 500,
                        background: '#fff', border: '1px solid #e8e8e3', color: '#1a1a1a',
                      }}
                    >
                      <TrendingUp size={11} style={{ color: '#999' }} />
                      {theme.text}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Positioning */}
            {report.competitorSnapshot.positioning && (
              <div
                className="mt-4 rounded-xl px-5 py-4"
                style={{
                  background: positioningIsPositive ? '#f0fdf4' : positioningIsNegative ? '#fefce8' : '#f5f5f3',
                  border: `1px solid ${positioningIsPositive ? '#d0e8d8' : positioningIsNegative ? '#f0e0b0' : '#e8e8e3'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <Target size={14} style={{ color: positioningIsPositive ? '#1a6b3c' : positioningIsNegative ? '#b8860b' : '#999' }} />
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999' }}>Our Positioning</span>
                </div>
                <p style={{
                  fontFamily: "'Instrument Serif', serif", fontSize: '15px', fontWeight: 400, lineHeight: 1.5, marginTop: '6px',
                  color: positioningIsPositive ? '#1a6b3c' : positioningIsNegative ? '#92400e' : '#1a1a1a',
                }}>
                  {report.competitorSnapshot.positioning}
                </p>
              </div>
            )}
          </section>

          {/* ─── Divider ─── */}
          <div style={{ height: '1px', background: '#e8e8e3' }} />

          {/* ─── News Items ─── */}
          {report.newsItems.length > 0 && (
            <section>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#e8eef5' }}>
                  <FileText size={14} style={{ color: '#2c5282' }} />
                </div>
                <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                  Top News Items
                </h3>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#999', marginLeft: '4px' }}>
                  {report.newsItems.length}
                </span>
              </div>

              <div className="space-y-3">
                {report.newsItems.map((item, i) => {
                  const isRisk = item.tags.includes('risk');
                  const isOpp = item.tags.includes('opportunity');
                  return (
                    <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                      {/* Card accent bar */}
                      <div style={{ height: '3px', background: isRisk ? '#dc3545' : isOpp ? '#2c5282' : '#e8e8e3' }} />
                      {/* Card header */}
                      <div className="px-5 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                              style={{
                                fontFamily: "'DM Mono', monospace", fontSize: '12px', fontWeight: 500,
                                background: isRisk ? '#fdedf0' : isOpp ? '#e8eef5' : '#f5f4f0',
                                color: isRisk ? '#dc3545' : isOpp ? '#2c5282' : '#999',
                              }}
                            >
                              {item.number}
                            </span>
                            <div className="min-w-0">
                              <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4, margin: 0 }}>{item.headline}</h4>
                              {item.source && (
                                <span style={{ fontSize: '11px', color: '#999', display: 'block', marginTop: '2px' }}>{item.source}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                            {item.tags.map((tag, j) => (
                              <TagBadge key={j} tag={tag} />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Card body */}
                      <div className="px-5 pb-4 space-y-3" style={{ borderTop: '1px solid #f0eeea' }}>
                        <div style={{ paddingTop: '12px' }} />
                        {item.whyItMatters && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <AlertTriangle size={10} style={{ color: '#b8860b' }} />
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#b8860b' }}>Why it matters</span>
                            </div>
                            <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.whyItMatters}</p>
                          </div>
                        )}
                        {item.sanghaImpact && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Target size={10} style={{ color: '#1a6b3c' }} />
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1a6b3c' }}>Sangha impact</span>
                            </div>
                            <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.sanghaImpact}</p>
                          </div>
                        )}
                        {item.actionability && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Zap size={10} style={{ color: '#2c5282' }} />
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2c5282' }}>Actionability</span>
                            </div>
                            <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.actionability}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* ─── Comments ─── */}
        <ReportCommentsSection reportId={dateKey || file.name} />

        {/* ─── Footer ─── */}
        <div className="shrink-0 px-8 py-4 flex items-center justify-between" style={{ background: '#fff', borderTop: '1px solid #e8e8e3' }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: '#999' }}>
            Generated {report.generated} by Intelligence Agent
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
              style={{ fontSize: '11px', fontWeight: 600, color: '#666', background: '#f5f4f0', border: '1px solid #e8e8e3' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eee'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#f5f4f0'; }}
            >
              <Printer size={11} />
              Print
            </button>
            {file.url && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
                style={{ fontSize: '11px', fontWeight: 600, color: '#fff', background: '#1a2e1a', border: '1px solid #1a2e1a' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#2a4a2a'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#1a2e1a'; }}
              >
                <Download size={11} />
                Export to Drive
              </button>
            )}
          </div>
        </div>

        {/* ─── Toast ─── */}
        {toast && (
          <div
            className="absolute bottom-16 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-xl shadow-lg"
            style={{
              background: '#1a2e1a', color: '#2dd478', fontSize: '12px', fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
              animation: 'fadeInUp 0.2s ease-out',
            }}
          >
            {toast}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

// ─── Demo Data ──────────────────────────────────────────────────────────────

const MINING_FOLDERS = {
  'Reports': {
    path: '/Sangha/Reports/',
    files: [
      { name: 'Week 10 Operations Report', type: 'doc', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
      { name: 'Daily Curtailment Summary — Mar 6', type: 'doc', owner: 'Workspace Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'February P&L Review', type: 'sheet', owner: 'Spencer Marr', modified: 'Mar 3, 2026', agent: false },
      { name: 'Q1 Insurance Progress', type: 'doc', owner: 'Spencer Marr', modified: 'Feb 28, 2026', agent: false },
    ],
  },
  'Presentations': {
    path: '/Sangha/Presentations/',
    files: [
      { name: 'Weekly Executive Briefing — W10', type: 'slides', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
      { name: 'Total Energies Meeting Deck', type: 'slides', owner: 'Spencer Marr', modified: 'Mar 5, 2026', agent: false },
      { name: 'Investor Update — February', type: 'slides', owner: 'Workspace Agent', modified: 'Mar 1, 2026', agent: true },
    ],
  },
  'Deals': {
    path: '/Sangha/Deals/',
    files: [
      { name: 'SunPeak Energy — Prospect Brief', type: 'doc', owner: 'Workspace Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'GridScale Partners — Term Sheet Draft', type: 'doc', owner: 'Spencer Marr', modified: 'Mar 4, 2026', agent: false },
      { name: 'Lead Pipeline Tracker', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
    ],
  },
  'Fleet': {
    path: '/Sangha/Fleet/',
    files: [
      { name: 'Fleet Inventory — March 2026', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
      { name: 'S19 Viability Analysis', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'Crane County Site Review', type: 'slides', owner: 'Spencer Marr', modified: 'Feb 25, 2026', agent: false },
      { name: 'Hardware Procurement Quotes', type: 'pdf', owner: 'Miguel Torres', modified: 'Feb 20, 2026', agent: false },
    ],
  },
  'Contacts': {
    path: '/Sangha/Contacts/',
    files: [
      { name: 'Sangha Lead Pipeline', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 10, 2026', agent: true, url: 'https://docs.google.com/spreadsheets/d/1ksDEJ6a5-sp_GaA0f6CKTzFW77np2rXsbevh0RZcuj0/edit' },
      { name: 'Sangha IPP Contact Report', type: 'doc', owner: 'Workspace Agent', modified: 'Mar 10, 2026', agent: true },
      { name: 'Lead Pipeline Tracker (Excel)', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 10, 2026', agent: true },
    ],
  },
  'Intelligence Agent': {
    path: '/Sangha/Intelligence Agent/',
    files: [
      { name: 'Weekly Intel 2026-02-06 — Mining Market Dynamics', type: 'doc', owner: 'Intelligence Agent', modified: 'Feb 6, 2026', agent: true, url: 'https://docs.google.com/document/d/19AFV6iWmX1GkrQ_lMMyx-WPspvL_EFCi0qLvTNho9kk/edit', isIntelReport: true },
      { name: 'Weekly Intel 2026-02-02 — Mining Market Dynamics', type: 'doc', owner: 'Intelligence Agent', modified: 'Feb 2, 2026', agent: true, url: 'https://docs.google.com/document/d/1b87WDk9l2ur82fHxC9LLPo62CXhV5aKbIP33EGFIrDE/edit', isIntelReport: true },
      { name: 'Weekly Intel 2026-01-29 — Mining Market Dynamics', type: 'doc', owner: 'Intelligence Agent', modified: 'Jan 29, 2026', agent: true, url: 'https://docs.google.com/document/d/1-ImCGM1hMK1g2cJtzhaRVa5-g9bf6dgv408cgXcL5nA/edit', isIntelReport: true },
    ],
  },
};

const DACP_FOLDERS = {
  'Estimates': {
    path: '/DACP/Estimates/',
    files: [
      { name: 'DACP_Estimate_BishopArts.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 9, 2026', agent: true },
      { name: 'DACP_Estimate_MemorialHermann_Ph2.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 6, 2026', agent: true },
      { name: 'DACP_Estimate_I35RetainingWalls.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 8, 2026', agent: true },
      { name: 'DACP_Estimate_SamsungFab_Revised.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 6, 2026', agent: true },
      { name: 'DACP_Estimate_McKinneyTC_Draft.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 8, 2026', agent: true },
    ],
  },
  'Meeting Notes': {
    path: '/DACP/Meeting Notes/',
    files: [
      { name: 'Turner_CoordinationCall_Mar6.pdf', type: 'pdf', owner: 'Meeting Bot', modified: 'Mar 6, 2026', agent: true },
      { name: 'WeeklyStandup_Mar5.pdf', type: 'pdf', owner: 'Meeting Bot', modified: 'Mar 5, 2026', agent: true },
      { name: 'DPR_SamsungFab_ScopeReview_Mar3.pdf', type: 'pdf', owner: 'Meeting Bot', modified: 'Mar 3, 2026', agent: true },
    ],
  },
  'Daily Reports': {
    path: '/DACP/Daily Reports/',
    files: [
      { name: 'DailyOps_Mar9.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 9, 2026', agent: true },
      { name: 'DailyOps_Mar8.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 8, 2026', agent: true },
      { name: 'DailyOps_Mar7.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 7, 2026', agent: true },
      { name: 'DailyOps_Mar6.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 6, 2026', agent: true },
    ],
  },
  'Field Reports': {
    path: '/DACP/Field Reports/',
    files: [
      { name: 'Westpark_DailyLog_Mar8.pdf', type: 'pdf', owner: 'Carlos Mendez', modified: 'Mar 8, 2026', agent: false },
      { name: 'Westpark_DailyLog_Mar7.pdf', type: 'pdf', owner: 'Carlos Mendez', modified: 'Mar 7, 2026', agent: false },
      { name: 'FriscoStation_RockFlag_Mar7.pdf', type: 'pdf', owner: 'Carlos Mendez', modified: 'Mar 7, 2026', agent: false },
    ],
  },
  'GC Correspondence': {
    path: '/DACP/GC Correspondence/',
    files: [
      { name: 'Turner_MemorialHermann_Ph2_Bid.pdf', type: 'pdf', owner: 'Email Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'HenselPhelps_I35_RFQ.pdf', type: 'pdf', owner: 'Email Agent', modified: 'Mar 8, 2026', agent: true },
      { name: 'DPR_SamsungFab_RevisedScope.pdf', type: 'pdf', owner: 'Email Agent', modified: 'Mar 6, 2026', agent: true },
    ],
  },
  'Pricing': {
    path: '/DACP/Pricing/',
    files: [
      { name: 'DACP_MasterPricingTable_2026.xlsx', type: 'sheet', owner: 'David Castillo', modified: 'Mar 1, 2026', agent: false },
      { name: 'TXI_PriceLetter_Mar2026.pdf', type: 'pdf', owner: 'Marcel Pineda', modified: 'Mar 1, 2026', agent: false },
    ],
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function FilesDashboard() {
  const { tenant } = useTenant();
  const isConstruction = tenant?.settings?.industry === 'construction';
  const demoFolders = isConstruction ? DACP_FOLDERS : MINING_FOLDERS;
  const driveRoot = isConstruction ? '/DACP/' : '/Sangha/';

  const [folders, setFolders] = useState(demoFolders);
  const [liveMode, setLiveMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(Object.keys(demoFolders)));
  const [selectedFolder, setSelectedFolder] = useState(Object.keys(demoFolders)[0]);
  const [search, setSearch] = useState('');
  const [totalFiles, setTotalFiles] = useState(0);
  const [viewingReport, setViewingReport] = useState(null);
  const [commentCounts, setCommentCounts] = useState({});

  // Fetch comment counts for intel reports
  useEffect(() => {
    const intelFolder = folders['Intelligence Agent'];
    if (!intelFolder) return;
    const reportIds = intelFolder.files
      .filter(f => f.isIntelReport)
      .map(f => {
        const m = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : f.name;
      });
    if (reportIds.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/report-comments/counts/batch?ids=${reportIds.join(',')}`);
        if (res.ok) {
          const data = await res.json();
          setCommentCounts(data.counts || {});
        }
      } catch {}
    })();
  }, [folders, viewingReport]);

  // Format date string for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Format file size
  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Convert API files into folder structure
  const buildFoldersFromApi = (files, categories) => {
    const grouped = {};
    for (const file of files) {
      const cat = file.category || 'Other';
      if (!grouped[cat]) {
        grouped[cat] = { path: `${driveRoot}${cat}/`, files: [] };
      }
      grouped[cat].files.push({
        name: file.name,
        type: file.file_type || 'other',
        owner: '',
        modified: formatDate(file.modified_at),
        agent: true,
        url: file.drive_url || null,
        isDrive: !!file.drive_url,
        size: file.size_bytes,
        category: cat,
      });
    }
    // Sort categories by count (use categories array order)
    if (categories) {
      const ordered = {};
      for (const cat of categories) {
        if (grouped[cat.category]) {
          ordered[cat.category] = grouped[cat.category];
        }
      }
      // Add any remaining
      for (const [k, v] of Object.entries(grouped)) {
        if (!ordered[k]) ordered[k] = v;
      }
      return ordered;
    }
    return grouped;
  };

  // Try to load real files from API
  useEffect(() => {
    let cancelled = false;
    async function fetchFiles() {
      try {
        // First try the tenant files endpoint
        const res = await fetch(`${API_BASE}/v1/files`);
        if (!res.ok) throw new Error('Files endpoint not available');
        const data = await res.json();
        if (!cancelled && data.files && data.files.length > 0) {
          const grouped = buildFoldersFromApi(data.files, data.categories);
          if (Object.keys(grouped).length > 0) {
            setFolders(grouped);
            setExpandedFolders(new Set(Object.keys(grouped)));
            setSelectedFolder(Object.keys(grouped)[0]);
            setLiveMode(true);
            setTotalFiles(data.total || data.files.length);
            return;
          }
        }
      } catch {
        // Fall through to workspace agent
      }

      // Fallback: try workspace agent
      try {
        const res = await fetch(`${API_BASE}/v1/workspace/files`);
        if (!res.ok) throw new Error('Workspace agent not available');
        const data = await res.json();
        if (!cancelled && data.files && data.files.length > 0) {
          const grouped = {};
          for (const file of data.files) {
            const folder = file.folder || 'Uncategorized';
            if (!grouped[folder]) grouped[folder] = { path: `${driveRoot}${folder}/`, files: [] };
            grouped[folder].files.push({
              name: file.name,
              type: file.type || 'doc',
              owner: file.owner || 'Unknown',
              modified: file.modified || '',
              agent: file.agent || false,
              url: file.url,
            });
          }
          if (Object.keys(grouped).length > 0) {
            setFolders(grouped);
            setExpandedFolders(new Set(Object.keys(grouped)));
            setSelectedFolder(Object.keys(grouped)[0]);
            setLiveMode(true);
          }
        }
      } catch {
        // Silently fall back to demo data
      }
    }
    fetchFiles();
    return () => { cancelled = true; };
  }, [isConstruction]);

  const refreshFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/files`);
      if (res.ok) {
        const data = await res.json();
        if (data.files?.length > 0) {
          const grouped = buildFoldersFromApi(data.files, data.categories);
          setFolders(grouped);
          setLiveMode(true);
          setTotalFiles(data.total || data.files.length);
        }
      }
    } catch {}
    setLoading(false);
  };

  const toggleFolder = (name) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setSelectedFolder(name);
  };

  const filteredFiles = useMemo(() => {
    if (!search.trim()) {
      return folders[selectedFolder]?.files || [];
    }
    const q = search.toLowerCase();
    const results = [];
    for (const [, folder] of Object.entries(folders)) {
      for (const file of folder.files) {
        if (file.name.toLowerCase().includes(q) || (file.owner && file.owner.toLowerCase().includes(q))) {
          results.push(file);
        }
      }
    }
    return results;
  }, [folders, selectedFolder, search]);

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Report Viewer Modal */}
      {viewingReport && (
        <ReportViewerModal
          file={viewingReport}
          onClose={() => setViewingReport(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-sm font-bold text-terminal-text tracking-[0.3px]">Files</h2>
        {liveMode ? (
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.5px] px-2 py-0.5 rounded-full bg-[#edf7f0] text-[#1a6b3c] border border-[#d0e8d8]">
            <span className="w-[5px] h-[5px] rounded-full bg-[#1a6b3c] animate-pulse" />
            Live
          </span>
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-2 py-0.5 rounded-full bg-[#f5f4f0] text-terminal-muted border border-terminal-border">Demo</span>
        )}
        {totalFiles > 0 && (
          <span className="text-[11px] text-terminal-muted">{totalFiles} files</span>
        )}
        <button
          onClick={refreshFiles}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-terminal-muted bg-[#f5f4f0] border border-terminal-border hover:bg-[#eeede8] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <div className="flex-1" />
        <div className="relative w-56">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-[12px] bg-[#f5f4f0] border border-terminal-border text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-terminal-green transition-colors"
          />
        </div>
      </div>

      <div className="flex gap-5">
        {/* Folder tree sidebar */}
        <div className="w-52 shrink-0">
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
            <div className="px-[14px] py-[10px] border-b border-[#f0eeea]">
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Folders</span>
            </div>
            <div className="py-1">
              {Object.keys(folders).map(name => {
                const isExpanded = expandedFolders.has(name);
                const isSelected = selectedFolder === name && !search.trim();
                return (
                  <button
                    key={name}
                    onClick={() => toggleFolder(name)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-medium transition-colors ${
                      isSelected
                        ? 'bg-[rgba(45,212,120,0.06)] text-terminal-text'
                        : 'text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text'
                    }`}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} className="shrink-0 opacity-40" />
                      : <ChevronRight size={12} className="shrink-0 opacity-40" />
                    }
                    <FolderOpen size={14} className={`shrink-0 ${isSelected ? 'text-terminal-green' : 'opacity-50'}`} />
                    <span className="truncate">{name}</span>
                    <span className="ml-auto text-[10px] text-terminal-muted tabular-nums">
                      {folders[name].files.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 min-w-0">
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_100px_140px] gap-2 px-[18px] py-[10px] border-b border-[#f0eeea]">
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Name</span>
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Modified</span>
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] text-right">Actions</span>
            </div>

            {/* Path breadcrumb */}
            {!search.trim() && (
              <div className="px-[18px] py-2 bg-[#f9f9f7] border-b border-[#f0eeea]">
                <span className="text-[10px] font-mono text-terminal-muted">
                  {folders[selectedFolder]?.path}
                </span>
              </div>
            )}
            {search.trim() && (
              <div className="px-[18px] py-2 bg-[#f9f9f7] border-b border-[#f0eeea]">
                <span className="text-[10px] text-terminal-muted">
                  {filteredFiles.length} result{filteredFiles.length !== 1 ? 's' : ''} for "{search}"
                </span>
              </div>
            )}

            {/* Files */}
            {filteredFiles.length === 0 ? (
              <div className="px-[18px] py-10 text-center text-[13px] text-terminal-muted">No files found.</div>
            ) : (
              filteredFiles.map((file, i) => {
                const icon = getFileIcon(file.type);
                const isExternal = file.isDrive || (file.url && file.url.startsWith('http'));
                const isReport = file.name.toLowerCase().includes('report') || file.name.toLowerCase().includes('contact');
                const isEstimate = file.name.toLowerCase().includes('estimate');
                const isPipeline = file.name.toLowerCase().includes('pipeline');
                const isIntelReport = file.isIntelReport === true;
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_100px_140px] gap-2 items-center px-[18px] py-2.5 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors group"
                  >
                    {/* Name with icon */}
                    <div
                      className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                      onClick={() => {
                        if (isIntelReport) {
                          setViewingReport(file);
                        } else if (isExternal) {
                          window.open(file.url, '_blank', 'noopener,noreferrer');
                        } else if (file.url) {
                          window.open(`${FILE_BASE}${file.url}`, '_blank');
                        }
                      }}
                    >
                      <span
                        className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{ background: icon.bg, color: icon.color }}
                      >
                        {icon.letter}
                      </span>
                      <span className="text-[13px] font-medium text-terminal-text truncate group-hover:text-[#2c5282] transition-colors">{file.name}</span>
                      {file.isDrive && (
                        <span className="flex items-center gap-1 text-[9px] font-semibold text-[#666] shrink-0" title="Opens in Google Drive">
                          <DriveIcon />
                        </span>
                      )}
                      {file.agent && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f3eef8] text-[#5b3a8c] border-[#d8cce8] shrink-0">
                          agent
                        </span>
                      )}
                      {isIntelReport && (() => {
                        const rid = file.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || file.name;
                        const cnt = commentCounts[rid];
                        return cnt > 0 ? (
                          <span className="flex items-center gap-1 text-[10px] font-semibold shrink-0" style={{ color: '#1a6b3c' }}>
                            <MessageCircle size={10} />
                            {cnt}
                          </span>
                        ) : null;
                      })()}
                      {file.size > 0 && (
                        <span className="text-[10px] text-terminal-muted shrink-0">{formatSize(file.size)}</span>
                      )}
                    </div>

                    {/* Modified */}
                    <span className="text-[12px] text-terminal-muted tabular-nums">{file.modified}</span>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(isReport || isPipeline) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const teamEmail = isConstruction ? 'Mpineda@dacpholdings.com' : 'spencer@sanghasystems.com';
                            const subject = encodeURIComponent(`Coppice Report: ${file.name}`);
                            const body = encodeURIComponent(`Hi,\n\nPlease find the latest ${file.name}.\n\n${file.url ? 'View in Drive: ' + file.url + '\n\n' : ''}Generated by Coppice on ${file.modified || new Date().toLocaleDateString()}.\n\nBest,\nCoppice Agent`);
                            window.open(`mailto:${teamEmail}?subject=${subject}&body=${body}`, '_self');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#1a6b3c] bg-[#edf7f0] border border-[#d0e8d8] hover:bg-[#dff0e5] transition-colors"
                          title="Send to team"
                        >
                          <Send size={9} /> Send
                        </button>
                      )}
                      {isEstimate && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const gcName = file.name.replace(/DACP_Estimate_|\.xlsx/g, '').replace(/_/g, ' ');
                            const subject = encodeURIComponent(`DACP Estimate — ${gcName}`);
                            const body = encodeURIComponent(`Please find attached our estimate for ${gcName}.\n\n${file.url ? 'View: ' + file.url + '\n\n' : ''}Best regards,\nDACP Construction`);
                            window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#2c5282] bg-[#e8eef5] border border-[#c5d5e8] hover:bg-[#dce6f0] transition-colors"
                          title="Send to GC"
                        >
                          <Mail size={9} /> Send to GC
                        </button>
                      )}
                      {isIntelReport ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingReport(file);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#1a6b3c] bg-[#edf7f0] border border-[#d0e8d8] hover:bg-[#dff0e5] transition-colors"
                        >
                          View Report <FileText size={9} />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isExternal) {
                              window.open(file.url, '_blank', 'noopener,noreferrer');
                            } else if (file.url) {
                              window.open(`${FILE_BASE}${file.url}`, '_blank');
                            }
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#2c5282] hover:bg-[#e8eef5] transition-colors"
                        >
                          Open <ExternalLink size={9} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
