"""Google API authentication and service builder."""

from functools import lru_cache
from google.oauth2 import service_account
from googleapiclient.discovery import build

from config import get_tenant_config

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
]

_service_cache: dict[str, dict] = {}


def get_credentials(tenant_id: str) -> service_account.Credentials:
    """Return Google credentials for the given tenant's service account."""
    cfg = get_tenant_config(tenant_id)
    key_path = cfg.get("service_account_key", "")
    return service_account.Credentials.from_service_account_file(
        key_path, scopes=SCOPES
    )


def build_service(api: str, version: str, tenant_id: str):
    """Build and cache a Google API service client.

    Supported: drive/v3, slides/v1, sheets/v4, docs/v1
    """
    cache_key = f"{tenant_id}:{api}:{version}"
    if cache_key not in _service_cache:
        creds = get_credentials(tenant_id)
        _service_cache[cache_key] = build(api, version, credentials=creds)
    return _service_cache[cache_key]


def drive_service(tenant_id: str):
    return build_service("drive", "v3", tenant_id)


def slides_service(tenant_id: str):
    return build_service("slides", "v1", tenant_id)


def sheets_service(tenant_id: str):
    return build_service("sheets", "v4", tenant_id)


def docs_service(tenant_id: str):
    return build_service("docs", "v1", tenant_id)
