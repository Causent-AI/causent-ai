"""Drain locally queued baseline-drift refresh jobs.

This is a local review helper, not a hosted worker. It refuses non-loopback
database targets so a browser review cannot accidentally drain production.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.parse import urlparse

import psycopg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from persistence.drift_materialization import drain_drift_refresh_jobs  # noqa: E402

DEFAULT_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def require_local_database(dsn: str) -> str:
    hostname = urlparse(dsn).hostname
    if hostname not in LOOPBACK_HOSTS:
        raise ValueError(
            "Local drift refresh only accepts a loopback DATABASE_URL "
            "(127.0.0.1, localhost, or ::1)."
        )
    return dsn


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--scope", default=None)
    args = parser.parse_args(argv)

    dsn = require_local_database(os.environ.get("DATABASE_URL", DEFAULT_DSN))
    with psycopg.connect(dsn) as conn:
        results = drain_drift_refresh_jobs(
            conn,
            limit=args.limit,
            scope_id=args.scope,
        )

    summary = [
        {
            "scope_id": str(result.scope_id),
            "generation": result.generation,
            "status": result.status,
            "detail": result.detail,
        }
        for result in results
    ]
    print(json.dumps({"processed": len(summary), "results": summary}, indent=2))
    return 1 if any(
        item["status"] in {"FAILED", "RETRY_SCHEDULED"} for item in summary
    ) else 0


if __name__ == "__main__":
    raise SystemExit(main())
