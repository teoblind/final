"""Google Drive comments — add, list, reply, resolve."""

from typing import Optional
from google_auth import drive_service


def add_comment(
    file_id: str,
    content: str,
    tenant_id: str,
    anchor: Optional[str] = None,
    tag_users: Optional[list[str]] = None,
) -> dict:
    """Add a comment to a Google Workspace file via Drive API v3."""
    svc = drive_service(tenant_id)

    # Prepend @mentions to content
    if tag_users:
        mentions = " ".join(f"@{email}" for email in tag_users)
        content = f"{mentions} {content}"

    body = {"content": content}

    # Anchor to specific content if provided
    if anchor:
        body["anchor"] = anchor

    comment = svc.comments().create(
        fileId=file_id,
        body=body,
        fields="id,content,author,createdTime",
    ).execute()

    return {
        "comment_id": comment["id"],
        "content": comment["content"],
        "author": comment.get("author", {}).get("displayName", ""),
        "created": comment.get("createdTime", ""),
    }


def list_comments(
    file_id: str,
    tenant_id: str,
    modified_after: Optional[str] = None,
) -> list[dict]:
    """List comments on a file, optionally filtered by modification time."""
    svc = drive_service(tenant_id)

    params = {
        "fileId": file_id,
        "fields": "comments(id,content,author,createdTime,modifiedTime,resolved,replies)",
        "includeDeleted": False,
    }

    result = svc.comments().list(**params).execute()
    comments = result.get("comments", [])

    # Filter by modified_after if provided
    if modified_after:
        comments = [
            c for c in comments
            if c.get("modifiedTime", "") > modified_after
        ]

    return [
        {
            "comment_id": c["id"],
            "content": c["content"],
            "author": c.get("author", {}).get("displayName", ""),
            "author_email": c.get("author", {}).get("emailAddress", ""),
            "created": c.get("createdTime", ""),
            "modified": c.get("modifiedTime", ""),
            "resolved": c.get("resolved", False),
            "replies": [
                {
                    "content": r.get("content", ""),
                    "author": r.get("author", {}).get("displayName", ""),
                    "author_email": r.get("author", {}).get("emailAddress", ""),
                    "created": r.get("createdTime", ""),
                }
                for r in c.get("replies", [])
            ],
        }
        for c in comments
    ]


def reply_to_comment(
    file_id: str,
    comment_id: str,
    content: str,
    tenant_id: str,
) -> dict:
    """Reply to an existing comment thread."""
    svc = drive_service(tenant_id)

    reply = svc.replies().create(
        fileId=file_id,
        commentId=comment_id,
        body={"content": content},
        fields="id,content,author,createdTime",
    ).execute()

    return {
        "reply_id": reply["id"],
        "content": reply["content"],
        "author": reply.get("author", {}).get("displayName", ""),
        "created": reply.get("createdTime", ""),
    }


def resolve_comment(file_id: str, comment_id: str, tenant_id: str) -> dict:
    """Resolve a comment thread."""
    svc = drive_service(tenant_id)

    # Resolve by replying with action = "resolve"
    reply = svc.replies().create(
        fileId=file_id,
        commentId=comment_id,
        body={"content": "Resolved", "action": "resolve"},
        fields="id",
    ).execute()

    return {"comment_id": comment_id, "status": "resolved"}
