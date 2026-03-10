"""Multi-model slide generation pipeline.

6-stage pipeline:
  1. Content Planning   — Anthropic API generates structured slide plan
  2. Style System       — Generates CSS + layout templates
  3. Image Generation   — Parallel image gen for visual slides (mock for now)
  4. Final Assembly     — Generates standalone HTML per slide
  5. Render to PNG      — Puppeteer/Playwright screenshots
  6. Upload             — Google Slides (full-bleed images) or PDF compilation
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Optional

import anthropic

from config import get_tenant_config
from google_auth import slides_service, drive_service
from tools.drive import upload_file, _resolve_folder_id

logger = logging.getLogger("presentation_pipeline")

MODEL = os.getenv("PRESENTATION_MODEL", "claude-sonnet-4-20250514")
RENDER_SCRIPT = Path(__file__).parent / "render_slides.js"


# ─── System Prompts ─────────────────────────────────────────────────────────

STAGE_1_SYSTEM_PROMPT = """\
You are a world-class presentation content strategist. Your job is to take a
topic, audience, and constraints and produce a detailed slide-by-slide plan
as structured JSON.

Rules:
- Each slide must have a clear, singular message.
- Use the "assertion–evidence" structure: the title IS the takeaway (a full
  sentence), and the body provides supporting evidence.
- Vary layouts across the deck: title_slide, section_header, assertion_evidence,
  big_number, image_full, two_column, quote, timeline, comparison, closing.
- For data-heavy points, specify chart type and exact data points.
- For visual slides, write a detailed image generation prompt in visual_description.
- Speaker notes should be conversational — what the presenter actually says.
- Keep bullet points to a maximum of 3 per slide. Prefer visuals over text.

Output ONLY valid JSON with this schema (no markdown fences, no commentary):
{
  "title": "Deck Title",
  "subtitle": "Subtitle or tagline",
  "slides": [
    {
      "index": 1,
      "layout": "title_slide | section_header | assertion_evidence | big_number | image_full | two_column | quote | timeline | comparison | closing",
      "title": "The assertion or heading",
      "content": {
        "body": "Supporting text or bullet points",
        "bullets": ["Point 1", "Point 2"],
        "big_number": "42%",
        "big_number_label": "of customers...",
        "quote_text": "...",
        "quote_attribution": "...",
        "left_column": "...",
        "right_column": "...",
        "timeline_items": [{"label": "Q1", "text": "..."}],
        "comparison": {"left_title": "Before", "right_title": "After", "left_items": [], "right_items": []}
      },
      "visual_needed": true,
      "visual_type": "hero_image | infographic | chart | icon_set | none",
      "visual_description": "A detailed prompt describing the desired visual...",
      "speaker_notes": "What the presenter says during this slide..."
    }
  ]
}"""

STAGE_2_SYSTEM_PROMPT = """\
You are an elite HTML/CSS presentation designer. Given a slide plan and brand
parameters, generate a cohesive design system.

Design principles:
- Cinematic, editorial quality. Think Apple keynote meets Swiss design.
- Generous whitespace. Content breathes.
- Typography hierarchy using Google Fonts: Instrument Sans (headings),
  Newsreader (body/quotes), JetBrains Mono (data/numbers).
- Slides are 1920x1080px. All units in px. No responsive breakpoints needed.
- Color palette: warm white background (#fafaf8), near-black text (#111110),
  accent color from brand config, subtle grays for secondary elements.
- Subtle gradients, not flat blocks. Organic shapes over hard rectangles.
- Data visualizations should use SVG, not images.

Output ONLY valid JSON (no markdown fences):
{
  "css": "/* Full CSS stylesheet content for deck_styles.css */",
  "layouts": {
    "title_slide": "<!-- HTML template with {{title}}, {{subtitle}} placeholders -->",
    "section_header": "...",
    "assertion_evidence": "...",
    "big_number": "...",
    "image_full": "...",
    "two_column": "...",
    "quote": "...",
    "timeline": "...",
    "comparison": "...",
    "closing": "..."
  },
  "color_tokens": {
    "background": "#fafaf8",
    "text_primary": "#111110",
    "accent": "#...",
    "accent_light": "#...",
    "gray_100": "#...",
    "gray_200": "#...",
    "gray_500": "#..."
  }
}"""

STAGE_4_SYSTEM_PROMPT = """\
You are a front-end engineer building presentation slides as standalone HTML
files. Each file must be a complete, self-contained HTML document that renders
perfectly at 1920x1080px.

Requirements:
- Inline ALL CSS (no external stylesheets). Include the design-system CSS
  provided, plus any slide-specific overrides.
- Import Google Fonts via <link> tags: Instrument Sans, Newsreader, JetBrains Mono.
- Viewport is exactly 1920x1080. Use a wrapper div with these exact dimensions,
  overflow: hidden, and the background color.
- For infographic/chart slides: generate the visualization directly using HTML,
  CSS, and inline SVG. Make them beautiful and precise. Use the accent color.
- If an image path is provided, embed it with <img src="file://..."> and style
  it appropriately for the layout (full bleed, contained, etc.).
- Every element must be pixel-perfect. No scrollbars, no overflow.
- Do not include speaker notes in the HTML — those are separate.

Output ONLY the complete HTML document, starting with <!DOCTYPE html> and ending
with </html>. No markdown fences, no commentary before or after."""


# ─── Stage 1: Content Planning ──────────────────────────────────────────────

async def stage_1_content_planning(
    topic: str,
    context: str,
    audience: str,
    slide_count: int,
    tone: str,
) -> dict:
    """Generate a structured slide plan from the topic and constraints."""
    logger.info("Stage 1: Content planning — topic=%r, slides=%d", topic, slide_count)

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    user_prompt = (
        f"Create a {slide_count}-slide presentation plan.\n\n"
        f"**Topic:** {topic}\n\n"
        f"**Context / background:** {context}\n\n"
        f"**Target audience:** {audience}\n\n"
        f"**Tone:** {tone}\n\n"
        f"Generate exactly {slide_count} slides. The first should be a title slide "
        f"and the last should be a closing/CTA slide."
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=STAGE_1_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text.strip()
    # Strip markdown fences if the model wrapped them
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    slide_plan = json.loads(raw)
    logger.info(
        "Stage 1 complete: %d slides planned (title=%r)",
        len(slide_plan.get("slides", [])),
        slide_plan.get("title"),
    )
    return slide_plan


# ─── Stage 2: Style System ──────────────────────────────────────────────────

async def stage_2_style_system(
    slide_plan: dict,
    tenant_id: str,
) -> dict:
    """Generate CSS stylesheet and HTML layout templates."""
    logger.info("Stage 2: Style system generation")

    tenant_cfg = get_tenant_config(tenant_id)
    accent_color = tenant_cfg.get("accent_color", "#2563eb")

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    layouts_used = list({s.get("layout", "blank") for s in slide_plan.get("slides", [])})

    user_prompt = (
        f"Design a presentation style system for a deck titled \"{slide_plan.get('title', '')}\".\n\n"
        f"**Brand accent color:** {accent_color}\n"
        f"**Layouts needed:** {', '.join(layouts_used)}\n\n"
        f"**Slide plan summary:**\n"
    )
    for s in slide_plan.get("slides", []):
        user_prompt += f"  - Slide {s.get('index', '?')}: [{s.get('layout')}] {s.get('title', '')}\n"

    user_prompt += (
        "\n\nGenerate the full CSS and HTML templates. Templates should use "
        "{{title}}, {{body}}, {{bullets}}, {{big_number}}, {{big_number_label}}, "
        "{{quote_text}}, {{quote_attribution}}, {{image_url}}, {{left_column}}, "
        "{{right_column}}, {{timeline_items}}, {{comparison}} as placeholders."
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=STAGE_2_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    style_system = json.loads(raw)
    logger.info(
        "Stage 2 complete: %d layout templates, CSS length=%d chars",
        len(style_system.get("layouts", {})),
        len(style_system.get("css", "")),
    )
    return style_system


# ─── Stage 3: Image Generation ──────────────────────────────────────────────

async def _generate_single_image(
    slide_index: int,
    visual_description: str,
    visual_type: str,
    work_dir: Path,
) -> tuple[int, Optional[str]]:
    """Generate a single image for a slide. Returns (index, file_path or None)."""
    logger.info("Stage 3: Generating image for slide %d (type=%s)", slide_index, visual_type)

    if visual_type == "infographic":
        # Infographics are generated as HTML/SVG in Stage 4 — skip image gen
        logger.info("  Slide %d is infographic — will be rendered in Stage 4", slide_index)
        return slide_index, None

    # ── MOCK implementation ──────────────────────────────────────────────
    # Replace this block with a real image generation API call
    # (e.g., Replicate Flux, DALL-E, Midjourney) when API keys are available.
    #
    # Expected real implementation:
    #   response = await replicate.async_run("black-forest-labs/flux-1.1-pro", ...)
    #   image_bytes = download(response.url)
    #   path.write_bytes(image_bytes)

    path = work_dir / f"image_slide_{slide_index:02d}.png"

    # Create a simple placeholder SVG rendered as a "image"
    placeholder_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <rect width="1920" height="1080" fill="#e8e8e4"/>
  <rect x="660" y="340" width="600" height="400" rx="24" fill="#d4d4cf" stroke="#bbb" stroke-width="2"/>
  <text x="960" y="520" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#888">
    Image Placeholder
  </text>
  <text x="960" y="570" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#aaa">
    Slide {slide_index}: {visual_description[:60]}...
  </text>
</svg>"""
    path.write_text(placeholder_svg)
    # Rename to .svg since it's an SVG placeholder
    svg_path = path.with_suffix(".svg")
    if svg_path != path:
        path.rename(svg_path)
    path = svg_path

    logger.info("  Slide %d: placeholder image saved to %s", slide_index, path)
    return slide_index, str(path)


async def stage_3_image_generation(
    slide_plan: dict,
    work_dir: Path,
) -> dict[int, str]:
    """Generate images for all slides that need visuals. Runs in parallel."""
    logger.info("Stage 3: Image generation (parallel)")

    tasks = []
    for slide in slide_plan.get("slides", []):
        if slide.get("visual_needed") and slide.get("visual_type", "none") != "none":
            tasks.append(
                _generate_single_image(
                    slide_index=slide["index"],
                    visual_description=slide.get("visual_description", ""),
                    visual_type=slide.get("visual_type", "hero_image"),
                    work_dir=work_dir,
                )
            )

    if not tasks:
        logger.info("Stage 3: No images needed")
        return {}

    results = await asyncio.gather(*tasks, return_exceptions=True)

    images: dict[int, str] = {}
    for result in results:
        if isinstance(result, Exception):
            logger.error("Image generation failed: %s", result)
            continue
        idx, path = result
        if path:
            images[idx] = path

    logger.info("Stage 3 complete: %d images generated", len(images))
    return images


# ─── Stage 4: Final Assembly ────────────────────────────────────────────────

async def stage_4_final_assembly(
    slide_plan: dict,
    style_system: dict,
    images: dict[int, str],
    work_dir: Path,
) -> list[Path]:
    """Generate a standalone HTML file for each slide."""
    logger.info("Stage 4: Final HTML assembly")

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    css = style_system.get("css", "")
    layouts = style_system.get("layouts", {})
    color_tokens = style_system.get("color_tokens", {})
    html_files: list[Path] = []

    for slide in slide_plan.get("slides", []):
        idx = slide["index"]
        layout_name = slide.get("layout", "blank")
        layout_template = layouts.get(layout_name, "")
        image_path = images.get(idx)

        user_prompt = (
            f"Generate a complete standalone HTML file for slide {idx}.\n\n"
            f"**Design system CSS:**\n```css\n{css}\n```\n\n"
            f"**Color tokens:** {json.dumps(color_tokens)}\n\n"
            f"**Layout template ({layout_name}):**\n```html\n{layout_template}\n```\n\n"
            f"**Slide data:**\n```json\n{json.dumps(slide, indent=2)}\n```\n\n"
        )

        if image_path:
            user_prompt += f"**Image file path:** file://{image_path}\n\n"

        if slide.get("visual_type") == "infographic":
            user_prompt += (
                "This slide needs an INFOGRAPHIC. Generate it directly using "
                "HTML, CSS, and inline SVG. Make it beautiful and data-rich.\n\n"
            )

        user_prompt += (
            "Remember: output ONLY the HTML document, 1920x1080 viewport, "
            "all CSS inlined, Google Fonts via <link> tags."
        )

        response = client.messages.create(
            model=MODEL,
            max_tokens=8192,
            system=STAGE_4_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        html_content = response.content[0].text.strip()
        # Strip markdown fences if present
        if html_content.startswith("```"):
            html_content = html_content.split("\n", 1)[1]
            if html_content.endswith("```"):
                html_content = html_content[:-3]
            html_content = html_content.strip()

        html_path = work_dir / f"slide_{idx:02d}.html"
        html_path.write_text(html_content, encoding="utf-8")
        html_files.append(html_path)
        logger.info("  Slide %d HTML written: %s (%d chars)", idx, html_path, len(html_content))

    logger.info("Stage 4 complete: %d HTML files generated", len(html_files))
    return html_files


# ─── Stage 5: Render to PNG ─────────────────────────────────────────────────

async def stage_5_render_to_png(
    html_files: list[Path],
    work_dir: Path,
) -> list[Path]:
    """Render HTML slides to PNG using Puppeteer via Node.js script."""
    logger.info("Stage 5: Rendering %d HTML files to PNG", len(html_files))

    output_dir = work_dir / "png"
    output_dir.mkdir(exist_ok=True)

    if not RENDER_SCRIPT.exists():
        logger.warning("Render script not found at %s — skipping PNG render", RENDER_SCRIPT)
        return []

    # Check if node and puppeteer are available
    try:
        result = subprocess.run(
            ["node", "-e", "require('puppeteer')"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        puppeteer_available = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        puppeteer_available = False

    if not puppeteer_available:
        logger.warning(
            "Puppeteer not installed — skipping PNG render. "
            "Install with: npm install puppeteer"
        )
        return []

    try:
        proc = await asyncio.create_subprocess_exec(
            "node", str(RENDER_SCRIPT), str(work_dir), str(output_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)

        if proc.returncode != 0:
            logger.error("Puppeteer render failed (exit %d): %s", proc.returncode, stderr.decode())
            return []

        rendered_paths = json.loads(stdout.decode())
        png_files = [Path(p) for p in rendered_paths]
        logger.info("Stage 5 complete: %d PNGs rendered", len(png_files))
        return png_files

    except asyncio.TimeoutError:
        logger.error("Puppeteer render timed out after 120s")
        return []
    except json.JSONDecodeError:
        logger.error("Could not parse Puppeteer output: %s", stdout.decode() if stdout else "")
        return []
    except Exception as e:
        logger.error("Stage 5 render error: %s", e)
        return []


# ─── Stage 6: Upload ────────────────────────────────────────────────────────

async def _upload_to_google_slides(
    png_files: list[Path],
    slide_plan: dict,
    tenant_id: str,
    folder: str,
) -> dict:
    """Create a Google Slides presentation with full-bleed PNG images."""
    logger.info("Stage 6: Uploading to Google Slides (%d slides)", len(png_files))

    svc_slides = slides_service(tenant_id)
    svc_drive = drive_service(tenant_id)

    title = slide_plan.get("title", "Untitled Presentation")

    # Create empty presentation
    presentation = svc_slides.presentations().create(body={"title": title}).execute()
    pres_id = presentation["presentationId"]

    # Delete the default blank slide
    default_slides = presentation.get("slides", [])
    if default_slides:
        svc_slides.presentations().batchUpdate(
            presentationId=pres_id,
            body={"requests": [{"deleteObject": {"objectId": default_slides[0]["objectId"]}}]},
        ).execute()

    # Upload each PNG and add as a full-bleed image slide
    for i, png_path in enumerate(png_files):
        slide_id = f"slide_img_{i}"

        # Upload PNG to Drive (temporarily) to get a content URL
        from googleapiclient.http import MediaFileUpload
        media = MediaFileUpload(str(png_path), mimetype="image/png")
        uploaded = svc_drive.files().create(
            body={"name": png_path.name},
            media_body=media,
            fields="id,webContentLink",
        ).execute()
        image_file_id = uploaded["id"]

        # Make the image publicly readable so Slides can fetch it
        svc_drive.permissions().create(
            fileId=image_file_id,
            body={"type": "anyone", "role": "reader"},
        ).execute()

        image_url = f"https://drive.google.com/uc?id={image_file_id}"

        # Create slide with full-bleed image
        requests = [
            {"createSlide": {"objectId": slide_id, "insertionIndex": i}},
            {
                "createImage": {
                    "url": image_url,
                    "elementProperties": {
                        "pageObjectId": slide_id,
                        "size": {
                            "width": {"magnitude": 10, "unit": "INCH"},
                            "height": {"magnitude": 5.625, "unit": "INCH"},
                        },
                        "transform": {
                            "scaleX": 1,
                            "scaleY": 1,
                            "translateX": 0,
                            "translateY": 0,
                            "unit": "INCH",
                        },
                    },
                }
            },
        ]

        # Add speaker notes if available
        slide_data = slide_plan.get("slides", [])[i] if i < len(slide_plan.get("slides", [])) else {}
        if slide_data.get("speaker_notes"):
            # Notes need to be added after the slide is created
            requests_batch = requests
            svc_slides.presentations().batchUpdate(
                presentationId=pres_id,
                body={"requests": requests_batch},
            ).execute()

            # Get the notes page object ID
            pres = svc_slides.presentations().get(presentationId=pres_id).execute()
            current_slide = pres["slides"][i]
            notes_id = (
                current_slide.get("slideProperties", {})
                .get("notesPage", {})
                .get("notesProperties", {})
                .get("speakerNotesObjectId")
            )
            if notes_id:
                svc_slides.presentations().batchUpdate(
                    presentationId=pres_id,
                    body={"requests": [{
                        "insertText": {
                            "objectId": notes_id,
                            "text": slide_data["speaker_notes"],
                            "insertionIndex": 0,
                        }
                    }]},
                ).execute()
        else:
            svc_slides.presentations().batchUpdate(
                presentationId=pres_id,
                body={"requests": requests},
            ).execute()

    # Move to target folder
    if folder:
        from tools.drive import move_to_folder
        move_to_folder(pres_id, folder, tenant_id)

    url = f"https://docs.google.com/presentation/d/{pres_id}/edit"
    logger.info("Stage 6 (Google Slides) complete: %s", url)
    return {"file_id": pres_id, "url": url, "format": "google_slides"}


async def _compile_to_pdf(
    png_files: list[Path],
    html_files: list[Path],
    slide_plan: dict,
    work_dir: Path,
    tenant_id: str,
    folder: str,
) -> dict:
    """Compile PNG slides (or HTML fallback) into a PDF and optionally upload."""
    logger.info("Stage 6: Compiling PDF")

    title = slide_plan.get("title", "Untitled Presentation")
    pdf_path = work_dir / f"{title.replace(' ', '_')}.pdf"

    # Try fpdf2 first
    try:
        from fpdf import FPDF

        pdf = FPDF(orientation="L", unit="mm", format=(171.45, 304.8))  # 16:9 ratio
        pdf.set_auto_page_break(auto=False)

        source_files = png_files if png_files else []

        if not source_files:
            # Fallback: create a text-based PDF from slide plan
            logger.warning("No PNG files available — creating text-based PDF")
            pdf = FPDF(orientation="L", unit="mm", format="A4")
            pdf.set_auto_page_break(auto=False)

            for slide in slide_plan.get("slides", []):
                pdf.add_page()
                pdf.set_font("Helvetica", "B", 28)
                pdf.set_xy(20, 30)
                pdf.cell(0, 15, slide.get("title", ""), align="C")

                body = slide.get("content", {})
                if isinstance(body, dict):
                    text = body.get("body", "")
                    bullets = body.get("bullets", [])
                    if bullets:
                        text += "\n" + "\n".join(f"  - {b}" for b in bullets)
                else:
                    text = str(body)

                if text:
                    pdf.set_font("Helvetica", "", 16)
                    pdf.set_xy(30, 60)
                    pdf.multi_cell(240, 10, text)
        else:
            for png_path in source_files:
                pdf.add_page()
                pdf.image(str(png_path), x=0, y=0, w=304.8, h=171.45)

        pdf.output(str(pdf_path))
        logger.info("PDF compiled with fpdf2: %s", pdf_path)

    except ImportError:
        logger.warning("fpdf2 not installed — cannot compile PDF")
        # Return HTML files as fallback
        return {
            "format": "html",
            "files": [str(f) for f in html_files],
            "slide_count": len(html_files),
            "message": "PDF compilation unavailable (fpdf2 not installed). HTML files returned.",
        }

    # Upload to Drive if a folder is specified
    if folder:
        result = upload_file(
            local_path=str(pdf_path),
            folder=folder,
            name=pdf_path.name,
            tenant_id=tenant_id,
        )
        result["format"] = "pdf"
        result["slide_count"] = len(slide_plan.get("slides", []))
        logger.info("Stage 6 (PDF) complete: uploaded to Drive — %s", result.get("url"))
        return result

    return {
        "format": "pdf",
        "local_path": str(pdf_path),
        "slide_count": len(slide_plan.get("slides", [])),
    }


# ─── Main Entry Point ───────────────────────────────────────────────────────

async def generate_presentation(
    topic: str,
    context: str,
    tenant_id: str,
    audience: str = "",
    slide_count: int = 10,
    tone: str = "Professional, confident, data-driven",
    output_format: str = "pdf",  # "pdf" or "google_slides"
    folder: str = "",
) -> dict:
    """Run the full 6-stage presentation generation pipeline.

    Args:
        topic: The presentation topic / title.
        context: Background information, data points, key messages.
        tenant_id: Tenant identifier for Google auth and config.
        audience: Description of the target audience.
        slide_count: Number of slides to generate.
        tone: Desired tone/voice for the content.
        output_format: "pdf" or "google_slides".
        folder: Google Drive folder path for upload (e.g. "/Sangha/Decks/").

    Returns:
        dict with keys: file_id, url, slide_count, format (and more depending on output).
    """
    run_id = uuid.uuid4().hex[:8]
    logger.info(
        "Pipeline start [%s] — topic=%r, slides=%d, format=%s, model=%s",
        run_id, topic, slide_count, output_format, MODEL,
    )

    # Create a working directory for this pipeline run
    work_dir = Path(tempfile.mkdtemp(prefix=f"slides_{run_id}_"))
    logger.info("Work directory: %s", work_dir)

    try:
        # ── Stage 1: Content Planning ────────────────────────────────────
        slide_plan = await stage_1_content_planning(
            topic=topic,
            context=context,
            audience=audience,
            slide_count=slide_count,
            tone=tone,
        )

        # Persist the plan for debugging
        (work_dir / "slide_plan.json").write_text(
            json.dumps(slide_plan, indent=2), encoding="utf-8"
        )

        # ── Stage 2: Style System ────────────────────────────────────────
        style_system = await stage_2_style_system(
            slide_plan=slide_plan,
            tenant_id=tenant_id,
        )

        (work_dir / "deck_styles.css").write_text(
            style_system.get("css", ""), encoding="utf-8"
        )
        (work_dir / "style_system.json").write_text(
            json.dumps(style_system, indent=2), encoding="utf-8"
        )

        # ── Stage 3: Image Generation (parallel) ────────────────────────
        images = await stage_3_image_generation(
            slide_plan=slide_plan,
            work_dir=work_dir,
        )

        # ── Stage 4: Final Assembly ─────────────────────────────────────
        html_files = await stage_4_final_assembly(
            slide_plan=slide_plan,
            style_system=style_system,
            images=images,
            work_dir=work_dir,
        )

        # ── Stage 5: Render to PNG ──────────────────────────────────────
        png_files = await stage_5_render_to_png(
            html_files=html_files,
            work_dir=work_dir,
        )

        # ── Stage 6: Upload / Compile ───────────────────────────────────
        if output_format == "google_slides" and png_files:
            result = await _upload_to_google_slides(
                png_files=png_files,
                slide_plan=slide_plan,
                tenant_id=tenant_id,
                folder=folder,
            )
        else:
            result = await _compile_to_pdf(
                png_files=png_files,
                html_files=html_files,
                slide_plan=slide_plan,
                work_dir=work_dir,
                tenant_id=tenant_id,
                folder=folder,
            )

        result["slide_count"] = len(slide_plan.get("slides", []))
        result["work_dir"] = str(work_dir)
        result["run_id"] = run_id

        logger.info("Pipeline complete [%s]: %s", run_id, result)
        return result

    except anthropic.APIError as e:
        logger.error("Anthropic API error in pipeline [%s]: %s", run_id, e)
        return {
            "error": f"Anthropic API error: {e}",
            "run_id": run_id,
            "work_dir": str(work_dir),
        }
    except json.JSONDecodeError as e:
        logger.error("JSON parse error in pipeline [%s]: %s", run_id, e)
        return {
            "error": f"Model returned invalid JSON: {e}",
            "run_id": run_id,
            "work_dir": str(work_dir),
        }
    except Exception as e:
        logger.error("Pipeline error [%s]: %s", run_id, e, exc_info=True)
        return {
            "error": str(e),
            "run_id": run_id,
            "work_dir": str(work_dir),
        }
