/**
 * Social Media Scraper for Daily Newsletter
 *
 * Two sources:
 *  1. X/Twitter - Groq compound-beta (has built-in web search) with site:x.com queries
 *  2. LinkedIn - Puppeteer scraping of public LinkedIn search results
 *
 * Returns structured results with direct post URLs for newsletter citations.
 */

// ── X/Twitter via Groq compound-beta ─────────────────────────────────────────

async function searchX(queries) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.log('[SocialScraper] No GROQ_API_KEY - skipping X search');
    return [];
  }

  const results = [];

  for (const query of queries) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'compound-beta',
          messages: [
            {
              role: 'system',
              content: 'You are a social media research assistant. Search X/Twitter for the most recent posts matching the query. For each relevant post found, return the author name, their X handle, a brief summary of what they posted, and the direct URL to the post. Focus on posts from the past 7 days. Return results as a JSON array.',
            },
            {
              role: 'user',
              content: `Search X/Twitter for: ${query}\n\nReturn a JSON array of posts. Each object: { "author": "Name", "handle": "@handle", "summary": "what they said", "url": "https://x.com/...", "date": "YYYY-MM-DD if known" }. Only include real posts with real URLs. If no results, return [].`,
            },
          ],
          max_tokens: 2000,
        }),
      });

      if (!res.ok) {
        console.warn(`[SocialScraper] Groq X search error ${res.status} for: ${query.slice(0, 50)}`);
        continue;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';

      // Extract JSON array from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const posts = JSON.parse(jsonMatch[0]);
          if (Array.isArray(posts)) {
            results.push(...posts.filter(p => p.url && p.summary));
          }
        } catch {}
      }

      // Rate limit between queries
      await new Promise(r => setTimeout(r, 1000));
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

  // X queries
  const xQueries = [
    `${region} construction project awarded this week`,
    `${region} general contractor new project concrete`,
    `data center construction Texas groundbreaking`,
    `${services[0]} subcontractor Texas opportunity`,
  ];

  // LinkedIn queries
  const linkedinQueries = [
    `${region} construction project awarded`,
    `general contractor ${region} new project`,
    `data center Texas construction groundbreaking`,
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
