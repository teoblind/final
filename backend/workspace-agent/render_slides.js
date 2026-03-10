#!/usr/bin/env node
/**
 * render_slides.js — Renders HTML slide files to PNG using Puppeteer.
 *
 * Usage:
 *   node render_slides.js <html_dir> <output_dir>
 *
 * Scans <html_dir> for slide_*.html files, screenshots each at 1920x1080
 * (2x device scale factor for crisp output = 3840x2160 PNG), and saves
 * the PNGs into <output_dir>.
 *
 * Prints a JSON array of output file paths to stdout on success.
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node render_slides.js <html_dir> <output_dir>");
    process.exit(1);
  }

  const htmlDir = path.resolve(args[0]);
  const outputDir = path.resolve(args[1]);

  if (!fs.existsSync(htmlDir)) {
    console.error(`HTML directory not found: ${htmlDir}`);
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  // Find all slide HTML files, sorted by name
  const htmlFiles = fs
    .readdirSync(htmlDir)
    .filter((f) => f.startsWith("slide_") && f.endsWith(".html"))
    .sort();

  if (htmlFiles.length === 0) {
    console.error(`No slide_*.html files found in ${htmlDir}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const outputPaths = [];

  try {
    for (const htmlFile of htmlFiles) {
      const htmlPath = path.join(htmlDir, htmlFile);
      const pngName = htmlFile.replace(".html", ".png");
      const pngPath = path.join(outputDir, pngName);

      const page = await browser.newPage();

      // Set viewport to 1920x1080 with 2x device scale for crisp rendering
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2,
      });

      // Load the HTML file
      const fileUrl = `file://${htmlPath}`;
      await page.goto(fileUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait a brief moment for fonts to load
      await page.evaluate(() => document.fonts.ready);

      // Take screenshot
      await page.screenshot({
        path: pngPath,
        type: "png",
        clip: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
        },
      });

      await page.close();
      outputPaths.push(pngPath);

      process.stderr.write(`Rendered: ${htmlFile} -> ${pngName}\n`);
    }
  } finally {
    await browser.close();
  }

  // Output the paths as JSON to stdout (for the Python caller to parse)
  process.stdout.write(JSON.stringify(outputPaths));
}

main().catch((err) => {
  console.error("Render error:", err.message);
  process.exit(1);
});
