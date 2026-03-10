"""Google Slides creation and modification tools."""

from typing import Optional
from google_auth import slides_service, drive_service
from tools.drive import move_to_folder
from tools.comments import add_comment

# Layout mapping to Slides API predefined layouts
LAYOUT_MAP = {
    "title": "TITLE",
    "title_body": "TITLE_AND_BODY",
    "two_column": "TITLE_AND_TWO_COLUMNS",
    "chart": "BLANK",
    "image": "BLANK",
    "blank": "BLANK",
}


def _build_slide_request(slide_def: dict, presentation_id: str) -> list[dict]:
    """Convert a slide definition to Slides API batchUpdate requests."""
    requests = []
    layout = LAYOUT_MAP.get(slide_def.get("layout", "blank"), "BLANK")

    # Create the slide
    slide_id = f"slide_{id(slide_def)}"
    requests.append({
        "createSlide": {
            "objectId": slide_id,
            "slideLayoutReference": {"predefinedLayout": layout},
        }
    })

    # Insert title text if provided
    if slide_def.get("title"):
        requests.append({
            "insertText": {
                "objectId": f"{slide_id}_title",
                "text": slide_def["title"],
                "insertionIndex": 0,
            }
        })

    # Insert body text if provided
    if slide_def.get("body"):
        requests.append({
            "insertText": {
                "objectId": f"{slide_id}_body",
                "text": slide_def["body"],
                "insertionIndex": 0,
            }
        })

    # Speaker notes
    if slide_def.get("notes"):
        requests.append({
            "insertText": {
                "objectId": f"{slide_id}_notes",
                "text": slide_def["notes"],
                "insertionIndex": 0,
            }
        })

    return requests


def create_slides(
    title: str,
    folder: str,
    slides: list[dict],
    tenant_id: str,
    comment: Optional[str] = None,
    tag_users: Optional[list[str]] = None,
) -> dict:
    """Create a new Google Slides presentation.

    Returns: { file_id, url }
    """
    svc = slides_service(tenant_id)

    # Create empty presentation
    presentation = svc.presentations().create(body={"title": title}).execute()
    presentation_id = presentation["presentationId"]

    # Build batch requests for all slides
    requests = []
    for slide_def in slides:
        requests.extend(_build_slide_request(slide_def, presentation_id))

    if requests:
        svc.presentations().batchUpdate(
            presentationId=presentation_id,
            body={"requests": requests},
        ).execute()

    # Move to target folder
    if folder:
        move_to_folder(presentation_id, folder, tenant_id)

    # Add initial comment if provided
    if comment:
        add_comment(presentation_id, comment, tenant_id, tag_users=tag_users)

    url = f"https://docs.google.com/presentation/d/{presentation_id}/edit"
    return {"file_id": presentation_id, "url": url}


def modify_slides(
    file_id: str,
    changes: list[dict],
    tenant_id: str,
    comment: Optional[str] = None,
    tag_users: Optional[list[str]] = None,
) -> dict:
    """Modify an existing Google Slides presentation.

    Each change has: slide_index, action (update_text | add_slide | delete_slide |
    replace_image | update_notes), content.
    """
    svc = slides_service(tenant_id)

    # Get current presentation to resolve slide object IDs
    presentation = svc.presentations().get(presentationId=file_id).execute()
    slide_objects = presentation.get("slides", [])

    requests = []
    for change in changes:
        idx = change.get("slide_index", 0)
        action = change.get("action", "")
        content = change.get("content", "")

        if action == "delete_slide" and idx < len(slide_objects):
            requests.append({
                "deleteObject": {"objectId": slide_objects[idx]["objectId"]}
            })

        elif action == "add_slide":
            layout = LAYOUT_MAP.get(content.get("layout", "blank") if isinstance(content, dict) else "blank", "BLANK")
            requests.append({
                "createSlide": {
                    "insertionIndex": idx,
                    "slideLayoutReference": {"predefinedLayout": layout},
                }
            })

        elif action == "update_notes" and idx < len(slide_objects):
            notes_id = slide_objects[idx].get("slideProperties", {}).get(
                "notesPage", {}
            ).get("notesProperties", {}).get("speakerNotesObjectId")
            if notes_id:
                requests.append({
                    "deleteText": {
                        "objectId": notes_id,
                        "textRange": {"type": "ALL"},
                    }
                })
                requests.append({
                    "insertText": {
                        "objectId": notes_id,
                        "text": content,
                        "insertionIndex": 0,
                    }
                })

    if requests:
        svc.presentations().batchUpdate(
            presentationId=file_id,
            body={"requests": requests},
        ).execute()

    if comment:
        add_comment(file_id, comment, tenant_id, tag_users=tag_users)

    return {"file_id": file_id, "status": "modified"}
