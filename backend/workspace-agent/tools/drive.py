"""Google Drive operations — search, read, upload, export, move."""

import io
from typing import Optional
from google_auth import drive_service
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

# MIME type mapping
MIME_TYPES = {
    "doc": "application/vnd.google-apps.document",
    "sheet": "application/vnd.google-apps.spreadsheet",
    "slides": "application/vnd.google-apps.presentation",
    "pdf": "application/pdf",
    "folder": "application/vnd.google-apps.folder",
}


def _resolve_folder_id(folder_path: str, tenant_id: str) -> Optional[str]:
    """Resolve a folder path like '/Sangha/Reports/' to a Drive folder ID.

    Walks the path from root, looking up each segment.
    """
    svc = drive_service(tenant_id)
    parts = [p for p in folder_path.strip("/").split("/") if p]
    parent_id = "root"

    for part in parts:
        query = (
            f"name = '{part}' and '{parent_id}' in parents "
            f"and mimeType = '{MIME_TYPES['folder']}' and trashed = false"
        )
        results = svc.files().list(q=query, fields="files(id)").execute()
        files = results.get("files", [])
        if not files:
            return None
        parent_id = files[0]["id"]

    return parent_id


def search_files(
    query: str,
    tenant_id: str,
    folder: Optional[str] = None,
    file_type: Optional[str] = None,
    modified_after: Optional[str] = None,
) -> list[dict]:
    """Search Google Drive for files matching criteria."""
    svc = drive_service(tenant_id)

    q_parts = [f"fullText contains '{query}'", "trashed = false"]

    if folder:
        folder_id = _resolve_folder_id(folder, tenant_id)
        if folder_id:
            q_parts.append(f"'{folder_id}' in parents")

    if file_type and file_type in MIME_TYPES:
        q_parts.append(f"mimeType = '{MIME_TYPES[file_type]}'")

    if modified_after:
        q_parts.append(f"modifiedTime > '{modified_after}'")

    results = svc.files().list(
        q=" and ".join(q_parts),
        fields="files(id,name,mimeType,modifiedTime,owners,webViewLink)",
        orderBy="modifiedTime desc",
        pageSize=20,
    ).execute()

    return [
        {
            "file_id": f["id"],
            "name": f["name"],
            "mime_type": f["mimeType"],
            "modified": f.get("modifiedTime"),
            "owner": f.get("owners", [{}])[0].get("displayName", ""),
            "url": f.get("webViewLink", ""),
        }
        for f in results.get("files", [])
    ]


def read_file(file_id: str, tenant_id: str) -> dict:
    """Read file content or metadata from Drive."""
    svc = drive_service(tenant_id)

    meta = svc.files().get(fileId=file_id, fields="id,name,mimeType,webViewLink").execute()
    mime = meta.get("mimeType", "")

    result = {
        "file_id": file_id,
        "name": meta["name"],
        "mime_type": mime,
        "url": meta.get("webViewLink", ""),
    }

    # For Google native docs, export as plain text
    if "google-apps.document" in mime:
        content = svc.files().export(fileId=file_id, mimeType="text/plain").execute()
        result["content"] = content.decode("utf-8") if isinstance(content, bytes) else content
    elif "google-apps.spreadsheet" in mime:
        content = svc.files().export(fileId=file_id, mimeType="text/csv").execute()
        result["content"] = content.decode("utf-8") if isinstance(content, bytes) else content
    else:
        result["content"] = None  # Binary files — metadata only

    return result


def upload_file(
    local_path: str,
    folder: str,
    name: str,
    tenant_id: str,
) -> dict:
    """Upload a local file to Google Drive."""
    svc = drive_service(tenant_id)

    file_metadata = {"name": name}
    folder_id = _resolve_folder_id(folder, tenant_id)
    if folder_id:
        file_metadata["parents"] = [folder_id]

    media = MediaFileUpload(local_path, resumable=True)
    uploaded = svc.files().create(
        body=file_metadata, media_body=media, fields="id,webViewLink"
    ).execute()

    return {
        "file_id": uploaded["id"],
        "url": uploaded.get("webViewLink", ""),
    }


def export_pdf(
    file_id: str,
    tenant_id: str,
    destination_folder: Optional[str] = None,
) -> dict:
    """Export a Google Doc/Slides/Sheet as PDF.

    If destination_folder is provided, saves a copy to Drive.
    """
    svc = drive_service(tenant_id)

    # Export as PDF bytes
    pdf_bytes = svc.files().export(fileId=file_id, mimeType="application/pdf").execute()

    result = {"file_id": file_id, "pdf_size": len(pdf_bytes)}

    # Optionally upload the PDF to Drive
    if destination_folder:
        meta = svc.files().get(fileId=file_id, fields="name").execute()
        pdf_name = f"{meta['name']}.pdf"
        folder_id = _resolve_folder_id(destination_folder, tenant_id)

        from googleapiclient.http import MediaInMemoryUpload

        media = MediaInMemoryUpload(pdf_bytes, mimetype="application/pdf")
        uploaded = svc.files().create(
            body={
                "name": pdf_name,
                "parents": [folder_id] if folder_id else [],
            },
            media_body=media,
            fields="id,webViewLink",
        ).execute()

        result["pdf_file_id"] = uploaded["id"]
        result["pdf_url"] = uploaded.get("webViewLink", "")

    return result


def create_folder(name: str, parent_folder: str, tenant_id: str) -> dict:
    """Create a folder in Drive."""
    svc = drive_service(tenant_id)

    file_metadata = {
        "name": name,
        "mimeType": MIME_TYPES["folder"],
    }
    parent_id = _resolve_folder_id(parent_folder, tenant_id)
    if parent_id:
        file_metadata["parents"] = [parent_id]

    folder = svc.files().create(body=file_metadata, fields="id").execute()
    return {"folder_id": folder["id"]}


def move_to_folder(file_id: str, folder_path: str, tenant_id: str) -> None:
    """Move a file to the specified folder path."""
    svc = drive_service(tenant_id)
    folder_id = _resolve_folder_id(folder_path, tenant_id)
    if not folder_id:
        return

    # Get current parents
    f = svc.files().get(fileId=file_id, fields="parents").execute()
    current_parents = ",".join(f.get("parents", []))

    svc.files().update(
        fileId=file_id,
        addParents=folder_id,
        removeParents=current_parents,
        fields="id,parents",
    ).execute()


def share_file(file_id: str, tenant_id: str, role: str = "writer") -> None:
    """Share a file so anyone with the link can access it."""
    svc = drive_service(tenant_id)
    try:
        svc.permissions().create(
            fileId=file_id,
            body={"type": "anyone", "role": role},
            fields="id",
        ).execute()
    except Exception as e:
        print(f"[Drive] Failed to share file {file_id}: {e}")


def move_file(file_id: str, destination_folder: str, tenant_id: str) -> dict:
    """Move a file to a new folder (public API)."""
    move_to_folder(file_id, destination_folder, tenant_id)
    return {"file_id": file_id, "status": "moved"}
