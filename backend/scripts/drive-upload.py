#!/usr/bin/env python3
"""
Upload generated files to Google Drive (coppice@zhan.capital).
Creates folder structure, uploads files, sets sharing permissions,
outputs JSON with Drive URLs for database update.
"""

import json
import os
import sys
import sqlite3
from pathlib import Path
from datetime import datetime
from uuid import uuid4

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# ─── Config ──────────────────────────────────────────────────────────────────

TOKEN_FILE = os.path.expanduser("~/MeetingBot/calendar_token.json")
CREDENTIALS_FILE = os.path.expanduser("~/Charger-Bot/credentials.json")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "cache.db")
DEMO_FILES_DIR = os.path.join(os.path.dirname(__file__), "..", "demo-files")

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
]

# Sharing permissions
SHARE_TARGETS = {
    "dacp-construction-001": [
        {"email": "Mpineda@dacpholdings.com", "role": "reader", "label": "Marcel"},
        {"email": "teo@zhan.capital", "role": "writer", "label": "Teo"},
    ],
    "default": [
        {"email": "spencer@sanghasystems.com", "role": "reader", "label": "Spencer"},
        {"email": "teo@zhan.capital", "role": "writer", "label": "Teo"},
    ],
}

# MIME types
MIME_MAP = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

# ─── Auth ────────────────────────────────────────────────────────────────────

def authenticate():
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(TOKEN_FILE, "w") as f:
                f.write(creds.to_json())
            print("Token refreshed.")
        else:
            print("ERROR: No valid credentials. Run calendar_auth.py first.")
            sys.exit(1)

    return build("drive", "v3", credentials=creds)


# ─── Drive Helpers ───────────────────────────────────────────────────────────

def find_or_create_folder(service, name, parent_id=None):
    """Find existing folder or create new one."""
    query = f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    if parent_id:
        query += f" and '{parent_id}' in parents"

    results = service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])

    if files:
        print(f"  Found folder: {name} ({files[0]['id'][:12]}...)")
        return files[0]["id"]

    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    if parent_id:
        metadata["parents"] = [parent_id]

    folder = service.files().create(body=metadata, fields="id").execute()
    print(f"  Created folder: {name} ({folder['id'][:12]}...)")
    return folder["id"]


def upload_file(service, local_path, filename, folder_id):
    """Upload a file to a Drive folder. Returns (file_id, webViewLink)."""
    ext = os.path.splitext(filename)[1].lower()
    mime_type = MIME_MAP.get(ext, "application/octet-stream")

    # Check if file already exists in folder
    query = f"name = '{filename}' and '{folder_id}' in parents and trashed = false"
    existing = service.files().list(q=query, fields="files(id)").execute().get("files", [])

    if existing:
        # Update existing file
        media = MediaFileUpload(local_path, mimetype=mime_type)
        file = service.files().update(
            fileId=existing[0]["id"],
            media_body=media,
            fields="id, webViewLink",
        ).execute()
        print(f"  Updated: {filename}")
    else:
        # Create new file
        metadata = {"name": filename, "parents": [folder_id]}
        media = MediaFileUpload(local_path, mimetype=mime_type)
        file = service.files().create(
            body=metadata, media_body=media,
            fields="id, webViewLink",
        ).execute()
        print(f"  Uploaded: {filename}")

    return file["id"], file.get("webViewLink", "")


def share_file(service, file_id, email, role="reader"):
    """Share a file with a user."""
    try:
        service.permissions().create(
            fileId=file_id,
            body={"type": "user", "role": role, "emailAddress": email},
            sendNotificationEmail=False,
        ).execute()
        return True
    except Exception as e:
        print(f"    Share error ({email}): {e}")
        return False


def share_folder_recursive(service, folder_id, email, role="reader"):
    """Share a folder (permissions propagate to children in Drive)."""
    share_file(service, folder_id, email, role)


# ─── File Manifest ───────────────────────────────────────────────────────────

def get_file_manifest():
    """Define all files to upload with their tenant, category, and local path."""
    base = DEMO_FILES_DIR
    files = []

    # DACP files
    dacp_files = [
        # Estimates
        ("estimates/DACP_Estimate_BishopArts_MixedUse.xlsx", "dacp-construction-001", "Estimates", "Estimates"),
        ("estimates/DACP_Estimate_I35_RetainingWalls.xlsx", "dacp-construction-001", "Estimates", "Estimates"),
        ("estimates/DACP_Estimate_MemorialHermann_Ph2.xlsx", "dacp-construction-001", "Estimates", "Estimates"),
        ("estimates/DACP_Estimate_SamsungFab_Revised.xlsx", "dacp-construction-001", "Estimates", "Estimates"),
        ("estimates/DACP_Estimate_McKinneyTC_Draft.xlsx", "dacp-construction-001", "Estimates", "Estimates"),
        # Leads
        ("leads/DACP_GC_Pipeline_Mar2026.xlsx", "dacp-construction-001", "Leads", "Leads"),
        ("leads/DACP_GC_Contacts_Report_Mar2026.docx", "dacp-construction-001", "Leads", "Leads"),
        # Pricing
        ("pricing/DACP_MasterPricingTable_2026.xlsx", "dacp-construction-001", "Pricing", "Pricing"),
    ]

    # Sangha files
    sangha_files = [
        ("leads/Sangha_Lead_Pipeline_Mar2026.xlsx", "default", "Leads", "Leads"),
        ("leads/Sangha_IPP_Contact_Report_Mar2026.docx", "default", "Leads", "Leads"),
    ]

    # Also include the report Excel from earlier if it exists
    report_xl = "reports/Sangha_Lead_Pipeline_2026-03-10.xlsx"
    if os.path.exists(os.path.join(base, report_xl)):
        sangha_files.append((report_xl, "default", "Reports", "Reports"))

    dacp_report_xl = "reports/DACP_Lead_Pipeline_2026-03-10.xlsx"
    if os.path.exists(os.path.join(base, dacp_report_xl)):
        dacp_files.append((dacp_report_xl, "dacp-construction-001", "Reports", "Reports"))

    for rel_path, tenant_id, drive_folder, db_category in dacp_files + sangha_files:
        full_path = os.path.join(base, rel_path)
        if os.path.exists(full_path):
            files.append({
                "local_path": full_path,
                "filename": os.path.basename(full_path),
                "tenant_id": tenant_id,
                "drive_folder": drive_folder,
                "db_category": db_category,
                "file_type": os.path.splitext(full_path)[1].lstrip("."),
            })
        else:
            print(f"  SKIP (not found): {rel_path}")

    return files


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Google Drive Upload — Coppice Files")
    print("=" * 60)

    service = authenticate()
    print("Authenticated as coppice@zhan.capital\n")

    # Create top-level Coppice folder
    print("Creating folder structure...")
    coppice_id = find_or_create_folder(service, "Coppice")

    # Tenant folders
    dacp_root = find_or_create_folder(service, "DACP Construction", coppice_id)
    sangha_root = find_or_create_folder(service, "Sangha Renewables", coppice_id)

    # Subfolders
    dacp_folders = {}
    for sub in ["Estimates", "Leads", "Pricing", "Reports"]:
        dacp_folders[sub] = find_or_create_folder(service, sub, dacp_root)

    sangha_folders = {}
    for sub in ["Leads", "Reports"]:
        sangha_folders[sub] = find_or_create_folder(service, sub, sangha_root)

    # Set sharing permissions on root folders
    print("\nSetting sharing permissions...")
    for target in SHARE_TARGETS["dacp-construction-001"]:
        print(f"  DACP → {target['label']} ({target['email']}) as {target['role']}")
        share_folder_recursive(service, dacp_root, target["email"], target["role"])

    for target in SHARE_TARGETS["default"]:
        print(f"  Sangha → {target['label']} ({target['email']}) as {target['role']}")
        share_folder_recursive(service, sangha_root, target["email"], target["role"])

    # Get file manifest
    print("\nPreparing files...")
    manifest = get_file_manifest()
    print(f"  {len(manifest)} files to upload\n")

    # Upload files
    print("Uploading files...")
    results = []

    for item in manifest:
        tenant_id = item["tenant_id"]
        folder_name = item["drive_folder"]

        if tenant_id == "dacp-construction-001":
            folder_id = dacp_folders.get(folder_name, dacp_root)
        else:
            folder_id = sangha_folders.get(folder_name, sangha_root)

        try:
            file_id, web_link = upload_file(
                service, item["local_path"], item["filename"], folder_id
            )
            results.append({
                **item,
                "drive_file_id": file_id,
                "drive_url": web_link,
                "size_bytes": os.path.getsize(item["local_path"]),
            })
        except Exception as e:
            print(f"  ERROR uploading {item['filename']}: {e}")

    # Update database
    print(f"\nUpdating database ({len(results)} files)...")
    db = sqlite3.connect(DB_PATH)
    cursor = db.cursor()

    for item in results:
        file_db_id = f"tf-{str(uuid4())[:8]}"
        cursor.execute(
            """INSERT OR REPLACE INTO tenant_files
            (id, tenant_id, name, category, file_type, size_bytes, modified_at, drive_file_id, drive_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                file_db_id,
                item["tenant_id"],
                item["filename"],
                item["db_category"],
                item["file_type"],
                item["size_bytes"],
                datetime.now().isoformat(),
                item["drive_file_id"],
                item["drive_url"],
            ),
        )

    db.commit()
    db.close()

    # Summary
    print("\n" + "=" * 60)
    print("  UPLOAD COMPLETE")
    print("=" * 60)
    dacp_count = sum(1 for r in results if r["tenant_id"] == "dacp-construction-001")
    sangha_count = sum(1 for r in results if r["tenant_id"] == "default")
    print(f"  DACP files:   {dacp_count}")
    print(f"  Sangha files: {sangha_count}")
    print(f"  Total:        {len(results)}")
    print()
    for r in results:
        print(f"  [{r['tenant_id'][:4]}] {r['filename']}")
        print(f"       → {r['drive_url']}")
    print()


if __name__ == "__main__":
    main()
