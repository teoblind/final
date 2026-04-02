/**
 * Social Media Scraper for Daily Newsletter
 *
 * Two sources:
 *  1. X/Twitter - xAI Grok API with x_search tool (searches real X posts)
 *  2. LinkedIn - Apify LinkedIn Post Search Scraper (no cookies needed)
 *
 * Returns structured results with direct post URLs for newsletter citations.
 */

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

  const results = [];

  for (const query of queries) {
    try {
      // Build LinkedIn search URL with keyword and date filter (past week)
      const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&datePosted=%22past-week%22&sortBy=%22date_posted%22`;

      // Run Apify actor synchronously (returns dataset items directly)
      // Actor: harvestapi/linkedin-post-search (no cookies needed)
      const res = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/run-sync-get-dataset-items?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: [searchUrl],
            maxResults: 10,
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[SocialScraper] Apify LinkedIn error ${res.status} for: ${query.slice(0, 50)}`, errText.slice(0, 200));
        continue;
      }

      const posts = await res.json();
      console.log(`[SocialScraper] LinkedIn query "${query.slice(0, 40)}": got ${posts.length} posts`);

      if (Array.isArray(posts)) {
        for (const post of posts) {
          // Apify returns various field names depending on the actor version
          const author = post.authorName || post.author || post.profileName || 'Unknown';
          const text = post.text || post.postText || post.content || '';
          const url = post.postUrl || post.url || post.linkedinUrl || '';
          const date = post.postedDate || post.date || post.publishedAt || '';

          if (url && text) {
            results.push({
              author,
              summary: text.substring(0, 200),
              url,
              date,
              platform: 'linkedin',
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[SocialScraper] LinkedIn search failed for: ${query.slice(0, 50)}`, err.message);
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

// ── Combined search for newsletter ───────────────────────────────────────────

export async function gatherSocialIntelligence(config) {
  const region = config.region || 'DFW Texas';
  const services = config.services || ['construction'];

  // X queries - broader to catch more posts, Grok filters by recency
  const xQueries = [
    `construction project Dallas OR "Fort Worth" OR DFW`,
    `Texas construction awarded OR groundbreaking OR "broke ground"`,
    `data center Texas construction OR building`,
    `general contractor Texas new project OR hiring OR bid`,
    `commercial construction Dallas OR Houston OR Austin OR Texas`,
    `concrete OR foundation OR "site work" Texas construction`,
  ];

  // LinkedIn queries - focused on recent posts
  const linkedinQueries = [
    `${region} construction project awarded`,
    `general contractor ${region} new project groundbreaking`,
    `data center Texas construction concrete`,
  ];

  console.log(`[SocialScraper] Searching X (${xQueries.length} queries) and LinkedIn (${linkedinQueries.length} queries)...`);

  const [xResults, linkedinResults] = await Promise.all([
    searchX(xQueries),
    searchLinkedIn(linkedinQueries),
  ]);

  console.log(`[SocialScraper] Found ${xResults.length} X posts, ${linkedinResults.length} LinkedIn posts`);

  return { xPosts: xResults, linkedinPosts: linkedinResults };
}

export default { searchX, searchLinkedIn, gatherSocialIntelligence };
