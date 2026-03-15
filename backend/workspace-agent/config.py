"""Configuration for the Workspace Agent microservice."""

import os
from dotenv import load_dotenv

load_dotenv()

# Server
WORKSPACE_PORT = int(os.getenv("WORKSPACE_PORT", "3010"))
AMPERA_BACKEND_URL = os.getenv("AMPERA_BACKEND_URL", "http://localhost:3002")
INTERNAL_SECRET = os.getenv("INTERNAL_SECRET", "dev-secret")

# Google
GOOGLE_SERVICE_ACCOUNT_KEY_PATH = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_KEY_PATH",
    os.path.expanduser("~/google-service-account.json"),
)

# Comment monitor
COMMENT_POLL_INTERVAL = int(os.getenv("COMMENT_POLL_INTERVAL", "120"))  # seconds
WATCH_LIST_PATH = os.getenv("WATCH_LIST_PATH", "watch_list.json")

# Per-tenant config (extend as tenants are onboarded)
TENANT_CONFIG = {
    "sangha": {
        "service_account_key": GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
        "root_folder": "/Sangha/",
        "agent_email": os.getenv("SANGHA_AGENT_EMAIL", ""),
    },
    "dacp": {
        "service_account_key": GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
        "root_folder": "/DACP/",
        "agent_email": os.getenv("DACP_AGENT_EMAIL", ""),
    },
}


def get_tenant_config(tenant_id: str) -> dict:
    """Return config for a given tenant, falling back to defaults."""
    return TENANT_CONFIG.get(tenant_id, TENANT_CONFIG.get("sangha", {}))

# Fal AI (image generation)
FAL_AI_API_KEY = os.getenv("FAL_AI_API_KEY", "")
