/**
 * Social Media Scraper for Daily Newsletter
 *
 * Two sources:
 *  1. X/Twitter - xAI Grok API with x_search tool (searches real X posts)
 *  2. LinkedIn - Puppeteer scraping via Google cache of LinkedIn posts
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
              content: `Search X for recent posts about: ${query}

Find up to 10 relevant posts. Return a JSON array where each object has:
- "author": the poster's display name
- "handle": their @username
- "summary": 1-2 sentence summary of the post content
- "url": the direct post URL (https://x.com/username/status/ID)
- "date": post date as YYYY-MM-DD

Return ONLY the JSON array, no other text. If nothing relevant found, return [].`,
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
              if (block.type === 'text') content += block.text;
            }
          }
        }
      }
      // Fallback for chat completions format
      if (!content && data.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content;
      }

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

// ── LinkedIn via Puppeteer ───────────────────────────────────────────────────

async function searchLinkedIn(queries) {
  let browser;
  try {
    const puppeteer = await import('puppeteer-core');

    // Find Chrome binary
    const chromePaths = [
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];

    let executablePath;
    const fs = await import('fs');
    for (const cp of chromePaths) {
      if (fs.existsSync(cp)) { executablePath = cp; break; }
    }
    if (!executablePath) {
      console.warn('[SocialScraper] No Chrome binary found - skipping LinkedIn');
      return [];
    }

    browser = await puppeteer.default.launch({
      executablePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const results = [];

    for (const query of queries) {
      try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // LinkedIn public search (no login required for some results)
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&datePosted=%22past-week%22&sortBy=%22date_posted%22`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        // Wait for content or auth wall
        await page.waitForSelector('body', { timeout: 5000 });

        // Check if we hit the auth wall
        const isAuthWall = await page.evaluate(() => {
          return document.querySelector('.join-form') !== null ||
                 document.querySelector('[data-tracking-control-name="auth_wall"]') !== null ||
                 document.body.innerText.includes('Sign in to view');
        });

        if (isAuthWall) {
          console.log('[SocialScraper] LinkedIn auth wall - trying Google cache approach');
          // Fallback: use Google to find LinkedIn posts
          const googleUrl = `https://www.google.com/search?q=site:linkedin.com/posts+${encodeURIComponent(query)}&tbs=qdr:w`;
          await page.goto(googleUrl, { waitUntil: 'networkidle2', timeout: 15000 });

          const googleResults = await page.evaluate(() => {
            const links = [];
            document.querySelectorAll('a[href*="linkedin.com/posts"], a[href*="linkedin.com/feed/update"]').forEach(a => {
              const title = a.closest('.g')?.querySelector('h3')?.textContent || a.textContent || '';
              const snippet = a.closest('.g')?.querySelector('.VwiC3b')?.textContent || '';
              const href = a.href;
              if (href && title) {
                links.push({ title: title.trim(), snippet: snippet.trim(), url: href });
              }
            });
            return links.slice(0, 5);
          });

          for (const gr of googleResults) {
            results.push({
              author: gr.title.split(' - ')[0] || 'Unknown',
              summary: gr.snippet || gr.title,
              url: gr.url,
              platform: 'linkedin',
            });
          }
        } else {
          // Scrape LinkedIn search results directly
          const posts = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('[data-urn]').forEach(el => {
              const authorEl = el.querySelector('.update-components-actor__name');
              const contentEl = el.querySelector('.update-components-text');
              const linkEl = el.querySelector('a[href*="/feed/update/"]');
              if (authorEl && contentEl) {
                items.push({
                  author: authorEl.textContent?.trim() || '',
                  summary: contentEl.textContent?.trim().substring(0, 200) || '',
                  url: linkEl?.href || '',
                  platform: 'linkedin',
                });
              }
            });
            return items.slice(0, 5);
          });
          results.push(...posts);
        }

        await page.close();
        // Rate limit
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`[SocialScraper] LinkedIn search failed for: ${query.slice(0, 50)}`, err.message);
      }
    }

    return results;
  } catch (err) {
    console.error('[SocialScraper] LinkedIn scraper error:', err.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
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
    `${region} construction project awarded 2026`,
    `general contractor ${region} new project groundbreaking`,
    `data center Texas construction concrete`,
  ];

  console.log(`[SocialScraper] Searching X (${xQueries.length} queries) and LinkedIn (${linkedinQueries.length} queries)...`);

  // LinkedIn Puppeteer scraping disabled - unreliable on VPS (auth walls + timeouts)
  // TODO: Replace with LinkedIn API or Proxycurl when available
  const [xResults, linkedinResults] = await Promise.all([
    searchX(xQueries),
    Promise.resolve([]),
  ]);

  console.log(`[SocialScraper] Found ${xResults.length} X posts, ${linkedinResults.length} LinkedIn posts`);

  return { xPosts: xResults, linkedinPosts: linkedinResults };
}

export default { searchX, searchLinkedIn, gatherSocialIntelligence };
