/**
 * Social Media Scraper for Daily Newsletter
 *
 * Two sources:
 *  1. X/Twitter - xAI Grok API with x_search tool (searches real X posts)
 *  2. LinkedIn - Apify LinkedIn Post Search Scraper (no cookies needed)
 *
 * Returns structured results with direct post URLs for newsletter citations.
 */

import { recordServiceUsage, getCurrentTenantId } from '../cache/database.js';

// ── X/Twitter via xAI Grok API with x_search tool ───────────────────────────

async function searchX(queries) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.log('[SocialScraper] No XAI_API_KEY - skipping X search');
    return [];
  }

  const results = [];

  for (const query of queries) {
    try {
      // Use xAI /v1/responses endpoint with x_search tool
      const res = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'grok-4-fast-non-reasoning',
          tools: [{ type: 'x_search' }],
          input: [
            {
              role: 'user',
              content: `Search X/Twitter for posts about: ${query}

Find posts from this week. Return a JSON array where each object has:
- "author": the poster's display name
- "handle": their @username
- "summary": 1-2 sentence summary of the post content
- "url": the direct post URL (https://x.com/username/status/ID)
- "date": post date as YYYY-MM-DD

Important: cast a wide net. Include posts from companies, journalists, industry accounts, local news, and individuals. Do not limit to only viral or trending posts. Return ONLY the JSON array, no other text. If nothing relevant found, return [].`,
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[SocialScraper] xAI X search error ${res.status} for: ${query.slice(0, 50)}`, errText.slice(0, 200));
        continue;
      }

      const data = await res.json();

      // xAI responses API returns output array with message items
      let content = '';
      if (data.output) {
        for (const item of data.output) {
          if (item.type === 'message' && item.content) {
            for (const block of item.content) {
              if (block.type === 'output_text') content += block.text;
              else if (block.type === 'text') content += block.text;
            }
          }
        }
      }
      // Fallback for chat completions format
      if (!content && data.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content;
      }

      console.log(`[SocialScraper] X query "${query.slice(0, 40)}": got ${content.length} chars of content`);

      // Track xAI Grok usage
      try {
        const tenantId = getCurrentTenantId();
        if (tenantId) recordServiceUsage(tenantId, 'xai_grok', 1, null, `X search: ${query.slice(0, 60)}`);
      } catch {}

      // Extract JSON array from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const posts = JSON.parse(jsonMatch[0]);
          if (Array.isArray(posts)) {
            results.push(...posts.filter(p => p.url && p.summary));
          }
        } catch (e) {
          console.warn(`[SocialScraper] Failed to parse X results JSON for: ${query.slice(0, 50)}`);
        }
      }

      // Brief pause between queries
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.warn(`[SocialScraper] X search failed for: ${query.slice(0, 50)}`, err.message);
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  return results.filter(p => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}

// ── LinkedIn via Apify Post Search Scraper ───────────────────────────────────

async function searchLinkedIn(queries) {
  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken) {
    console.log('[SocialScraper] No APIFY_API_TOKEN - skipping LinkedIn search');
    return [];
  }

  try {
    // Run all queries in a single Apify actor call (saves runs on free tier)
    // Actor: harvestapi/linkedin-post-search (no cookies needed)
    // Input: searchQueries array, scrapePages limits results
    const res = await fetch(
      `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/run-sync-get-dataset-items?token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchQueries: queries,
          scrapePages: 1, // 1 page = ~50 posts per query
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[SocialScraper] Apify LinkedIn error ${res.status}:`, errText.slice(0, 300));
      return [];
    }

    const posts = await res.json();
    console.log(`[SocialScraper] LinkedIn: got ${posts.length} raw posts from Apify`);

    if (!Array.isArray(posts)) return [];

    // 24h cutoff - only keep posts from the last 24 hours
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

    const results = [];
    let skippedOld = 0;
    for (const post of posts) {
      // Parse author - can be an object with name field or a string
      let authorName = 'Unknown';
      let authorTitle = '';
      if (typeof post.author === 'object' && post.author) {
        authorName = post.author.name || post.author.publicIdentifier || 'Unknown';
        authorTitle = post.author.headline || post.author.title || '';
      } else if (typeof post.author === 'string') {
        authorName = post.author;
      }

      // Parse URL
      const url = post.linkedinUrl || post.postUrl || post.url || '';

      // Parse content
      const text = post.content || post.text || post.postText || '';

      // Parse date from postedAt object or string
      let date = '';
      if (typeof post.postedAt === 'object' && post.postedAt) {
        date = post.postedAt.date || '';
        if (date) date = date.split('T')[0]; // YYYY-MM-DD
      } else if (typeof post.postedAt === 'string') {
        date = post.postedAt;
      }

      // Strict 24h filter - skip posts older than 24 hours
      if (date && date < cutoffStr) {
        skippedOld++;
        continue;
      }

      // Only include posts with actual content, URLs, and construction relevance
      const lowerText = text.toLowerCase();
      const isRelevant = [
        'construction', 'concrete', 'foundation', 'groundbreaking', 'broke ground',
        'awarded', 'general contractor', 'subcontract', 'data center', 'project',
        'building', 'development', 'commercial', 'industrial', 'infrastructure',
        'bid', 'preconstruction', 'site work', 'flatwork', 'tilt-wall', 'slab',
        'paving', 'curb', 'gutter', 'excavat', 'grading', 'hiring', 'superintendent',
        'project manager', 'safety', 'topping out', 'permit', 'zoning',
        'hensel phelps', 'je dunn', 'mccarthy', 'turner', 'skanska', 'whiting-turner',
        'rogers-o\'brien', 'manhattan construction', 'austin commercial', 'balfour beatty',
        'million', 'billion', '$', 'sq ft', 'sqft', 'megawatt', 'mw', 'gw',
      ].some(kw => lowerText.includes(kw));

      if (url && text && text.length > 20 && isRelevant) {
        results.push({
          author: authorName,
          authorTitle,
          summary: text.substring(0, 300),
          url,
          date,
          platform: 'linkedin',
        });
      }
    }

    console.log(`[SocialScraper] LinkedIn: skipped ${skippedOld} old posts (before ${cutoffStr}), kept ${results.length} recent+relevant`);

    // Deduplicate by URL
    const seen = new Set();
    return results.filter(p => {
      if (seen.has(p.url)) return false;
      seen.add(p.url);
      return true;
    });
  } catch (err) {
    console.warn(`[SocialScraper] LinkedIn search failed:`, err.message);
    return [];
  }
}

// ── Combined search for newsletter ───────────────────────────────────────────

export async function gatherSocialIntelligence(config) {
  const region = config.region || 'DFW Texas';
  const services = config.services || ['construction'];
  const markets = config.markets || [];
  const hasMultipleMarkets = markets.length > 1;

  // X queries - broad construction intel across DFW and Texas
  const xQueries = [
    `construction project Dallas OR "Fort Worth" OR DFW`,
    `Texas construction awarded OR groundbreaking OR "broke ground"`,
    `general contractor Texas new project OR hiring OR bid`,
    `commercial construction Dallas OR Houston OR Austin OR Texas`,
    `concrete OR foundation OR "site work" Texas construction`,
    `Texas construction bid OR permit OR "project awarded" OR warehouse`,
  ];

  // LinkedIn queries - broad construction intel, not just data centers
  const linkedinQueries = [
    `${region} construction project awarded groundbreaking`,
    `general contractor Texas new project awarded bid`,
    `concrete masonry foundation Texas commercial construction`,
    `Texas construction "broke ground" OR "under construction" OR "topping out"`,
    `commercial industrial warehouse construction Texas DFW`,
    `municipal infrastructure Texas construction water sewer road`,
    `multifamily apartment construction Texas groundbreaking`,
  ];

  // Add queries for secondary markets (Louisiana, Florida, etc.)
  if (hasMultipleMarkets) {
    const secondaryMarkets = markets.filter(m => !m.primary);
    for (const market of secondaryMarkets) {
      const mName = market.name;
      const mRegion = market.region;
      // Add 2 X queries per secondary market
      xQueries.push(
        `construction project awarded ${mName} OR "${mRegion}"`,
        `general contractor ${mName} new project OR concrete OR masonry`,
      );
      // Add 2 LinkedIn queries per secondary market
      linkedinQueries.push(
        `${mRegion} construction project awarded groundbreaking concrete`,
        `general contractor ${mName} new project awarded bid commercial`,
      );
    }
  }

  console.log(`[SocialScraper] Searching X (${xQueries.length} queries) and LinkedIn (${linkedinQueries.length} queries)${hasMultipleMarkets ? ` across ${markets.length} markets` : ''}...`);

  const [xResults, linkedinResults] = await Promise.all([
    searchX(xQueries),
    searchLinkedIn(linkedinQueries),
  ]);

  console.log(`[SocialScraper] Found ${xResults.length} X posts, ${linkedinResults.length} LinkedIn posts`);

  return { xPosts: xResults, linkedinPosts: linkedinResults };
}

export default { searchX, searchLinkedIn, gatherSocialIntelligence };
