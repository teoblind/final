"""Google Docs creation and modification tools."""

import re
from typing import Optional
from google_auth import docs_service
from tools.drive import move_to_folder
from tools.comments import add_comment


def _markdown_to_doc_requests(md_text: str) -> list[dict]:
    """Convert markdown text to Google Docs API insertText + style requests.

    Handles: # headings, **bold**, *italic*, bullet lists, plain paragraphs.
    Returns requests in reverse order (insert from end to start).
    """
    lines = md_text.strip().split("\n")
    requests = []
    offset = 1  # Docs starts at index 1

    for line in lines:
        stripped = line.strip()
        if not stripped:
            # Empty line → newline
            requests.append({
                "insertText": {"location": {"index": offset}, "text": "\n"}
            })
            offset += 1
            continue

        # Detect heading level
        heading_match = re.match(r"^(#{1,6})\s+(.*)", stripped)
        is_bullet = stripped.startswith("- ") or stripped.startswith("* ")
        bold_ranges = []
        italic_ranges = []

        if heading_match:
            level = len(heading_match.group(1))
            text = heading_match.group(2)
            heading_type = {
                1: "HEADING_1",
                2: "HEADING_2",
                3: "HEADING_3",
                4: "HEADING_4",
                5: "HEADING_5",
                6: "HEADING_6",
            }.get(level, "HEADING_1")
        elif is_bullet:
            text = stripped[2:]
            heading_type = None
        else:
            text = stripped
            heading_type = None

        # Strip inline bold/italic markers and track ranges
        clean_text = text
        # Process **bold**
        for m in re.finditer(r"\*\*(.+?)\*\*", clean_text):
            bold_ranges.append((m.start(), m.end() - 4))  # adjust for removed markers
        clean_text = re.sub(r"\*\*(.+?)\*\*", r"\1", clean_text)

        # Process *italic*
        for m in re.finditer(r"\*(.+?)\*", clean_text):
            italic_ranges.append((m.start(), m.end() - 2))
        clean_text = re.sub(r"\*(.+?)\*", r"\1", clean_text)

        # Insert text
        insert_text = clean_text + "\n"
        requests.append({
            "insertText": {"location": {"index": offset}, "text": insert_text}
        })

        text_start = offset
        text_end = offset + len(insert_text)

        # Apply heading style
        if heading_type:
            requests.append({
                "updateParagraphStyle": {
                    "range": {"startIndex": text_start, "endIndex": text_end},
                    "paragraphStyle": {"namedStyleType": heading_type},
                    "fields": "namedStyleType",
                }
            })

        # Apply bullet
        if is_bullet:
            requests.append({
                "createParagraphBullets": {
                    "range": {"startIndex": text_start, "endIndex": text_end},
                    "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                }
            })

        # Apply bold ranges
        for start, end in bold_ranges:
            requests.append({
                "updateTextStyle": {
                    "range": {
                        "startIndex": text_start + start,
                        "endIndex": text_start + end,
                    },
                    "textStyle": {"bold": True},
                    "fields": "bold",
                }
            })

        # Apply italic ranges
        for start, end in italic_ranges:
            requests.append({
                "updateTextStyle": {
                    "range": {
                        "startIndex": text_start + start,
                        "endIndex": text_start + end,
                    },
                    "textStyle": {"italic": True},
                    "fields": "italic",
                }
            })

        offset = text_end

    return requests


def create_doc(
    title: str,
    folder: str,
    content: str,
    tenant_id: str,
    comment: Optional[str] = None,
    tag_users: Optional[list[str]] = None,
) -> dict:
    """Create a new Google Doc with markdown content.

    Returns: { file_id, url }
    """
    svc = docs_service(tenant_id)

    # Create empty doc
    doc = svc.documents().create(body={"title": title}).execute()
    doc_id = doc["documentId"]

    # Convert markdown to Docs API requests and apply
    if content:
        requests = _markdown_to_doc_requests(content)
        if requests:
            svc.documents().batchUpdate(
                documentId=doc_id,
                body={"requests": requests},
            ).execute()

    # Move to folder
    if folder:
        move_to_folder(doc_id, folder, tenant_id)

    if comment:
        add_comment(doc_id, comment, tenant_id, tag_users=tag_users)

    url = f"https://docs.google.com/document/d/{doc_id}/edit"
    return {"file_id": doc_id, "url": url}


def modify_doc(
    file_id: str,
    changes: list[dict],
    tenant_id: str,
    comment: Optional[str] = None,
    tag_users: Optional[list[str]] = None,
) -> dict:
    """Modify an existing Google Doc.

    Each change has: action (append | replace_section | insert_at | add_comment_at),
    location, content.
    """
    svc = docs_service(tenant_id)

    for change in changes:
        action = change.get("action", "")
        content = change.get("content", "")

        if action == "append":
            # Get document end index
            doc = svc.documents().get(documentId=file_id).execute()
            end_index = doc["body"]["content"][-1]["endIndex"] - 1

            requests = [{
                "insertText": {
                    "location": {"index": end_index},
                    "text": content + "\n",
                }
            }]
            svc.documents().batchUpdate(
                documentId=file_id,
                body={"requests": requests},
            ).execute()

        elif action == "replace_section":
            location = change.get("location", "")
            doc = svc.documents().get(documentId=file_id).execute()

            # Find section by heading text
            start_idx = None
            end_idx = None
            for element in doc["body"]["content"]:
                if "paragraph" in element:
                    para = element["paragraph"]
                    text = "".join(
                        e.get("textRun", {}).get("content", "")
                        for e in para.get("elements", [])
                    ).strip()
                    if text == location and start_idx is None:
                        start_idx = element["startIndex"]
                    elif start_idx is not None and para.get("paragraphStyle", {}).get(
                        "namedStyleType", ""
                    ).startswith("HEADING"):
                        end_idx = element["startIndex"]
                        break

            if start_idx is not None:
                if end_idx is None:
                    end_idx = doc["body"]["content"][-1]["endIndex"] - 1

                requests = [
                    {
                        "deleteContentRange": {
                            "range": {
                                "startIndex": start_idx,
                                "endIndex": end_idx,
                            }
                        }
                    },
                    {
                        "insertText": {
                            "location": {"index": start_idx},
                            "text": content + "\n",
                        }
                    },
                ]
                svc.documents().batchUpdate(
                    documentId=file_id,
                    body={"requests": requests},
                ).execute()

    if comment:
        add_comment(file_id, comment, tenant_id, tag_users=tag_users)

    return {"file_id": file_id, "status": "modified"}
