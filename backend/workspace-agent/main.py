"""Workspace Agent — FastAPI microservice for Google Workspace operations.

This is an invisible tool layer. Other agents (hivemind, curtailment, reporting, etc.)
invoke these endpoints to create, modify, read, and comment on Google Workspace files.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from config import WORKSPACE_PORT, INTERNAL_SECRET
from comment_monitor import monitor
from tools import slides, sheets, docs, drive, comments
from templates import get_template, fill_template, list_templates

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("workspace")


# ─── Auth ────────────────────────────────────────────────────────────────────

def verify_request(x_tenant_id: str, x_internal_secret: str):
    if not x_tenant_id:
        raise HTTPException(status_code=400, detail="Missing X-Tenant-Id header")
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
    return x_tenant_id


# ─── Request Models ──────────────────────────────────────────────────────────

class CreateSlidesRequest(BaseModel):
    title: str
    folder: str
    slides: list[dict]
    comment: Optional[str] = None
    tag_users: Optional[list[str]] = None

class ModifySlidesRequest(BaseModel):
    file_id: str
    changes: list[dict]
    comment: Optional[str] = None
    tag_users: Optional[list[str]] = None

class CreateSheetRequest(BaseModel):
    title: str
    folder: str
    sheets: list[dict]
    comment: Optional[str] = None
    tag_users: Optional[list[str]] = None

class ModifySheetRequest(BaseModel):
    file_id: str
    changes: list[dict]
    comment: Optional[str] = None
    tag_users: Optional[list[str]] = None

class CreateDocRequest(BaseModel):
    title: str
    folder: str
    content: str
    comment: Optional[str] = None
    tag_users: Optional[list[str]] = None

class ModifyDocRequest(BaseModel):
    file_id: str
    changes: list[dict]
    comment: Optional[str] = None
    tag_users: Optional[list[str]] = None

class SearchDriveRequest(BaseModel):
    query: str
    folder: Optional[str] = None
    file_type: Optional[str] = None
    modified_after: Optional[str] = None

class ReadFileRequest(BaseModel):
    file_id: str

class UploadFileRequest(BaseModel):
    local_path: str
    folder: str
    name: str

class ExportPdfRequest(BaseModel):
    file_id: str
    destination_folder: Optional[str] = None

class AddCommentRequest(BaseModel):
    file_id: str
    content: str
    anchor: Optional[str] = None

class WatchCommentsRequest(BaseModel):
    file_id: str
    callback_agent: str = "hivemind"

class GeneratePresentationRequest(BaseModel):
    topic: str
    context: str
    audience: str = ""
    slide_count: int = 10
    tone: str = "Professional, confident, data-driven"
    output_format: str = "pdf"
    folder: str = ""

class PlanContentRequest(BaseModel):
    topic: str
    context: str
    audience: str = ""
    slide_count: int = 10
    tone: str = "Professional, confident, data-driven"
    include_backgrounds: bool = False


# ─── Lifespan ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch comment monitor background task
    task = asyncio.create_task(monitor.run())
    logger.info("Workspace Agent started on port %d", WORKSPACE_PORT)
    yield
    # Shutdown
    task.cancel()
    logger.info("Workspace Agent shutting down")


app = FastAPI(
    title="Workspace Agent",
    description="Invisible tool layer for Google Workspace operations",
    version="1.0.0",
    lifespan=lifespan,
)


# ─── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "workspace-agent",
        "watched_files": len(monitor.watched_files),
    }


# ─── Slides ──────────────────────────────────────────────────────────────────

@app.post("/tools/workspace_create_slides")
async def create_slides_endpoint(
    req: CreateSlidesRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return slides.create_slides(
        title=req.title,
        folder=req.folder,
        slides=req.slides,
        tenant_id=tenant_id,
        comment=req.comment,
        tag_users=req.tag_users,
    )


@app.post("/tools/workspace_modify_slides")
async def modify_slides_endpoint(
    req: ModifySlidesRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return slides.modify_slides(
        file_id=req.file_id,
        changes=req.changes,
        tenant_id=tenant_id,
        comment=req.comment,
        tag_users=req.tag_users,
    )


# ─── Sheets ──────────────────────────────────────────────────────────────────

@app.post("/tools/workspace_create_sheet")
async def create_sheet_endpoint(
    req: CreateSheetRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return sheets.create_sheet(
        title=req.title,
        folder=req.folder,
        sheets=req.sheets,
        tenant_id=tenant_id,
        comment=req.comment,
        tag_users=req.tag_users,
    )


@app.post("/tools/workspace_modify_sheet")
async def modify_sheet_endpoint(
    req: ModifySheetRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return sheets.modify_sheet(
        file_id=req.file_id,
        changes=req.changes,
        tenant_id=tenant_id,
        comment=req.comment,
        tag_users=req.tag_users,
    )


# ─── Docs ────────────────────────────────────────────────────────────────────

@app.post("/tools/workspace_create_doc")
async def create_doc_endpoint(
    req: CreateDocRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return docs.create_doc(
        title=req.title,
        folder=req.folder,
        content=req.content,
        tenant_id=tenant_id,
        comment=req.comment,
        tag_users=req.tag_users,
    )


@app.post("/tools/workspace_modify_doc")
async def modify_doc_endpoint(
    req: ModifyDocRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return docs.modify_doc(
        file_id=req.file_id,
        changes=req.changes,
        tenant_id=tenant_id,
        comment=req.comment,
        tag_users=req.tag_users,
    )


# ─── Drive ───────────────────────────────────────────────────────────────────

@app.post("/tools/workspace_search_drive")
async def search_drive_endpoint(
    req: SearchDriveRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return drive.search_files(
        query=req.query,
        tenant_id=tenant_id,
        folder=req.folder,
        file_type=req.file_type,
        modified_after=req.modified_after,
    )


@app.post("/tools/workspace_read_file")
async def read_file_endpoint(
    req: ReadFileRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return drive.read_file(file_id=req.file_id, tenant_id=tenant_id)


@app.post("/tools/workspace_upload_file")
async def upload_file_endpoint(
    req: UploadFileRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return drive.upload_file(
        local_path=req.local_path,
        folder=req.folder,
        name=req.name,
        tenant_id=tenant_id,
    )


@app.post("/tools/workspace_export_pdf")
async def export_pdf_endpoint(
    req: ExportPdfRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return drive.export_pdf(
        file_id=req.file_id,
        tenant_id=tenant_id,
        destination_folder=req.destination_folder,
    )


# ─── Comments ────────────────────────────────────────────────────────────────

@app.post("/tools/workspace_add_comment")
async def add_comment_endpoint(
    req: AddCommentRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    return comments.add_comment(
        file_id=req.file_id,
        content=req.content,
        tenant_id=tenant_id,
        anchor=req.anchor,
    )


@app.post("/tools/workspace_watch_comments")
async def watch_comments_endpoint(
    req: WatchCommentsRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    monitor.watch(req.file_id, req.callback_agent, tenant_id)
    return {"status": "watching", "file_id": req.file_id, "callback_agent": req.callback_agent}


# ─── Presentation Pipeline ────────────────────────────────────────────────────

@app.post("/tools/generate_presentation")
async def generate_presentation_endpoint(
    req: GeneratePresentationRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    from presentation_pipeline import generate_presentation
    result = await generate_presentation(
        topic=req.topic,
        context=req.context,
        tenant_id=tenant_id,
        audience=req.audience,
        slide_count=req.slide_count,
        tone=req.tone,
        output_format=req.output_format,
        folder=req.folder,
    )
    return result


# ─── Plan Content (Stage 1 only) ─────────────────────────────────────────────

@app.post("/tools/plan_content")
async def plan_content_endpoint(
    req: PlanContentRequest,
    x_tenant_id: str = Header(""),
    x_internal_secret: str = Header(""),
):
    """Run only Stage 1 (content planning) and return the structured slide plan for review."""
    tenant_id = verify_request(x_tenant_id, x_internal_secret)
    from presentation_pipeline import stage_1_content_planning
    import json
    import tempfile
    from pathlib import Path

    slide_plan = await stage_1_content_planning(
        topic=req.topic,
        context=req.context,
        audience=req.audience,
        slide_count=req.slide_count,
        tone=req.tone,
    )

    # Extract image prompts from the plan
    image_prompts = []
    for slide in slide_plan.get("slides", []):
        if slide.get("visual_needed") and slide.get("visual_description"):
            image_prompts.append({
                "slide_index": slide.get("index"),
                "layout": slide.get("layout"),
                "title": slide.get("title", ""),
                "visual_type": slide.get("visual_type", "hero_image"),
                "visual_description": slide.get("visual_description"),
            })

    return {
        "slide_plan": slide_plan,
        "image_prompts": image_prompts,
        "slide_count": len(slide_plan.get("slides", [])),
        "include_backgrounds": req.include_backgrounds,
    }


# ─── Templates ───────────────────────────────────────────────────────────────

@app.get("/templates")
async def list_templates_endpoint(
    tenant_id: Optional[str] = None,
):
    templates = list_templates(tenant_id)
    return [t.model_dump() for t in templates]


@app.get("/templates/{template_id}")
async def get_template_endpoint(
    template_id: str,
    tenant_id: Optional[str] = None,
):
    tmpl = get_template(template_id, tenant_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tmpl.model_dump()
