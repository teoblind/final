"""Background comment watcher — monitors Google Workspace files for new comments."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from config import COMMENT_POLL_INTERVAL, AMPERA_BACKEND_URL, INTERNAL_SECRET, WATCH_LIST_PATH, get_tenant_config
from tools.comments import list_comments, reply_to_comment

logger = logging.getLogger("workspace.comment_monitor")


class CommentMonitor:
    """Watches Google Workspace files for new comments and routes them to agents."""

    def __init__(self):
        self.watched_files: dict[str, dict] = {}
        # { file_id: { callback_agent, last_checked, tenant_id } }
        self._load_watch_list()

    def _load_watch_list(self):
        """Load persisted watch list from disk."""
        path = Path(WATCH_LIST_PATH)
        if path.exists():
            try:
                data = json.loads(path.read_text())
                self.watched_files = data
                logger.info("Loaded %d watched files from %s", len(data), WATCH_LIST_PATH)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to load watch list: %s", e)

    def _save_watch_list(self):
        """Persist watch list to disk for restart recovery."""
        try:
            Path(WATCH_LIST_PATH).write_text(json.dumps(self.watched_files, indent=2))
        except OSError as e:
            logger.warning("Failed to save watch list: %s", e)

    def watch(self, file_id: str, callback_agent: str, tenant_id: str):
        """Add a file to the watch list."""
        self.watched_files[file_id] = {
            "callback_agent": callback_agent,
            "last_checked": datetime.now(timezone.utc).isoformat(),
            "tenant_id": tenant_id,
        }
        self._save_watch_list()
        logger.info("Watching file %s → agent %s", file_id, callback_agent)

    def unwatch(self, file_id: str):
        """Remove a file from the watch list."""
        if file_id in self.watched_files:
            del self.watched_files[file_id]
            self._save_watch_list()
            logger.info("Unwatched file %s", file_id)

    async def _forward_to_agent(
        self,
        tenant_id: str,
        agent_id: str,
        message: str,
        context: dict,
    ):
        """Forward a comment to the appropriate agent via the Ampera backend."""
        url = f"{AMPERA_BACKEND_URL}/api/v1/chat/{agent_id}/messages"
        payload = {
            "message": message,
            "context": context,
            "source": "google_comment",
        }
        headers = {
            "X-Tenant-Id": tenant_id,
            "X-Internal-Secret": INTERNAL_SECRET,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    return resp.json()
                else:
                    logger.error(
                        "Agent %s returned %d: %s", agent_id, resp.status_code, resp.text
                    )
        except httpx.HTTPError as e:
            logger.error("Failed to forward to agent %s: %s", agent_id, e)

        return None

    async def _check_file(self, file_id: str, watch_info: dict):
        """Check a single file for new comments since last check."""
        tenant_id = watch_info["tenant_id"]
        last_checked = watch_info.get("last_checked", "")
        callback_agent = watch_info.get("callback_agent", "hivemind")

        # Get agent email to skip own comments
        tenant_cfg = get_tenant_config(tenant_id)
        agent_email = tenant_cfg.get("agent_email", "")

        try:
            comments = list_comments(file_id, tenant_id, modified_after=last_checked)
        except Exception as e:
            logger.error("Failed to list comments for %s: %s", file_id, e)
            return

        for comment in comments:
            # Skip resolved comments
            if comment.get("resolved"):
                continue

            # Skip own comments
            if agent_email and comment.get("author_email") == agent_email:
                continue

            # Check replies too — find new ones
            has_new_content = comment.get("modified", "") > last_checked

            if has_new_content:
                logger.info(
                    "New comment on %s by %s: %s",
                    file_id,
                    comment.get("author", "unknown"),
                    comment.get("content", "")[:100],
                )

                # Forward to the callback agent
                response = await self._forward_to_agent(
                    tenant_id=tenant_id,
                    agent_id=callback_agent,
                    message=comment["content"],
                    context={
                        "source": "google_comment",
                        "file_id": file_id,
                        "comment_id": comment["comment_id"],
                        "author": comment.get("author", ""),
                        "author_email": comment.get("author_email", ""),
                    },
                )

                # Reply to the comment with the agent's response
                if response and response.get("text"):
                    try:
                        reply_to_comment(
                            file_id,
                            comment["comment_id"],
                            response["text"],
                            tenant_id,
                        )
                    except Exception as e:
                        logger.error("Failed to reply to comment: %s", e)

        # Update last checked
        watch_info["last_checked"] = datetime.now(timezone.utc).isoformat()

    async def run(self):
        """Main monitor loop — runs every COMMENT_POLL_INTERVAL seconds."""
        logger.info(
            "Comment monitor started — polling every %ds, watching %d files",
            COMMENT_POLL_INTERVAL,
            len(self.watched_files),
        )

        while True:
            if self.watched_files:
                for file_id, watch_info in list(self.watched_files.items()):
                    await self._check_file(file_id, watch_info)

                self._save_watch_list()

            await asyncio.sleep(COMMENT_POLL_INTERVAL)


# Singleton instance
monitor = CommentMonitor()
