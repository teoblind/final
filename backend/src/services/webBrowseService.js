/**
 * Web Browse Service — fetch URLs and extract clean text content
 *
 * Uses native fetch + cheerio to scrape pages. Strips noise (scripts, styles, nav, ads)
 * and returns structured data: title, description, text, and links.
 */

import * as cheerio from 'cheerio';

const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT = 10_000; // 10 seconds
const MAX_TEXT_LENGTH = 15_000;
const MAX_LINKS = 20;

const USER_AGENT = 'CoppiceBot/1.0 (compatible; research assistant)';

/**
 * Fetch a URL and extract its content.
 * @param {string} url - Full URL to fetch
 * @param {{ extract?: 'text' | 'links' | 'all' }} options
 * @returns {{ title, description, url, text?, links?, word_count }}
 */
export async function browseUrl(url, options = {}) {
  const extract = options.extract || 'all';

  // Validate URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT / 1000}s: ${url}`);
    }
    throw new Error(`Failed to fetch ${url}: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    // Non-HTML — return raw text preview
    const text = await response.text();
    return {
      title: parsed.hostname,
      description: `Non-HTML content (${contentType})`,
      url,
      text: text.slice(0, MAX_TEXT_LENGTH),
      links: [],
      word_count: text.split(/\s+/).length,
    };
  }

  // Check size before reading body
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large (${(contentLength / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_RESPONSE_SIZE / 1024 / 1024} MB`);
  }

  const html = await response.text();
  if (html.length > MAX_RESPONSE_SIZE) {
    throw new Error(`Response body too large. Max: ${MAX_RESPONSE_SIZE / 1024 / 1024} MB`);
  }

  const $ = cheerio.load(html);

  // Extract metadata
  const title = $('title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    parsed.hostname;
  const description = $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') || '';

  const result = { title, description, url };

  // Extract text content
  if (extract === 'text' || extract === 'all') {
    // Remove noise elements
    $('script, style, nav, footer, header, aside, iframe, noscript, svg').remove();
    $('[role="navigation"], [role="banner"], [role="complementary"]').remove();
    $('.nav, .navbar, .sidebar, .footer, .ad, .ads, .advertisement, .cookie-banner').remove();

    // Get text from main content area if available, otherwise body
    let textRoot = $('main, article, [role="main"], .content, .post-content, .entry-content').first();
    if (textRoot.length === 0) textRoot = $('body');

    let text = textRoot.text()
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
    }

    result.text = text;
    result.word_count = text.split(/\s+/).filter(Boolean).length;
  }

  // Extract links
  if (extract === 'links' || extract === 'all') {
    const links = [];
    $('a[href]').each((_, el) => {
      if (links.length >= MAX_LINKS) return false;
      const href = $(el).attr('href');
      const linkText = $(el).text().trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      try {
        const absolute = new URL(href, url).href;
        if (linkText) links.push({ text: linkText.slice(0, 100), url: absolute });
      } catch { /* skip invalid URLs */ }
    });
    result.links = links;
  }

  return result;
}
