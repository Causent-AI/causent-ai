"""Fail-closed runtime configuration for stateful worker database clients."""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlsplit

_PROJECT_REF = re.compile(r"[a-z0-9]{20}")
_SUPAVISOR_HOST = re.compile(r"(?:^|\.)pooler\.supabase\.com$")


class WorkerConfigurationError(Exception):
    """A non-sensitive worker configuration error safe to expose as a code."""


def require_worker_database_url(raw_dsn: str | None, *, expected_role: str) -> str:
    """Return an exact role-scoped Supavisor DSN or fail without echoing it."""

    dsn = str(raw_dsn or "").strip()
    if not dsn:
        raise WorkerConfigurationError("DATABASE_URL_MISSING")

    try:
        parsed = urlsplit(dsn)
        hostname = (parsed.hostname or "").lower()
        port = parsed.port
        username = parsed.username or ""
        password = parsed.password or ""
        database = parsed.path.lstrip("/")
        username_prefix = f"{expected_role}."
        project_ref = (
            username[len(username_prefix) :]
            if username.startswith(username_prefix)
            else ""
        )
        query = parse_qsl(parsed.query, keep_blank_values=True)
    except (TypeError, ValueError):
        raise WorkerConfigurationError("DATABASE_URL_INVALID") from None

    if (
        parsed.scheme not in {"postgres", "postgresql"}
        or not _SUPAVISOR_HOST.search(hostname)
        or port != 5432
        or database != "postgres"
        or not password
        or _PROJECT_REF.fullmatch(project_ref) is None
        or query != [("sslmode", "require")]
    ):
        raise WorkerConfigurationError("DATABASE_URL_INVALID")
    return dsn
