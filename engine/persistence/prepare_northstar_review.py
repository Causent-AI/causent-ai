"""Prepare the bounded Northstar completed-loop data in local Supabase.

This helper imports one synthetic daily series through the checked workspace
metric RPC and selects four populated context metrics through the checked core
metric RPC. It refuses non-loopback databases and never changes report, series,
activation, prediction, or current-pointer rows.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import psycopg

DEFAULT_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DEFAULT_SCOPE = "ca5e0000-0000-0000-0000-0000000000d3"
METRIC_NAME = "First-week Setup Completion"
CORE_METRIC_NAMES = (
    "Activation Rate",
    "ARR",
    "Churn Rate",
    "Support Tickets",
)
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def require_local_database(dsn: str) -> str:
    """Return the DSN only when it explicitly targets loopback."""
    if urlparse(dsn).hostname not in LOOPBACK_HOSTS:
        raise ValueError(
            "Northstar review setup only accepts a loopback DATABASE_URL "
            "(127.0.0.1, localhost, or ::1)."
        )
    return dsn


def load_observations(path: Path) -> list[dict[str, str | float]]:
    """Parse an exact date,value CSV into bounded JSON-ready observations."""
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != ["date", "value"]:
            raise ValueError("Northstar sample CSV must contain exactly date,value columns.")
        observations: list[dict[str, str | float]] = []
        seen_dates: set[str] = set()
        for row_number, row in enumerate(reader, start=2):
            raw_date = (row.get("date") or "").strip()
            raw_value = (row.get("value") or "").strip()
            try:
                normalized_date = date.fromisoformat(raw_date).isoformat()
                value = float(raw_value)
            except (TypeError, ValueError) as error:
                raise ValueError(f"Invalid Northstar observation on row {row_number}.") from error
            if not math.isfinite(value) or normalized_date in seen_dates:
                raise ValueError(f"Invalid Northstar observation on row {row_number}.")
            seen_dates.add(normalized_date)
            observations.append({"date": normalized_date, "value": value})
    if not observations or len(observations) > 10_000:
        raise ValueError("Northstar sample must contain one to 10,000 observations.")
    return observations


def _current_pointer(conn: psycopg.Connection, scope_id: str) -> str | None:
    row = conn.execute(
        "select current_decision_report_series_id from public.workspaces "
        "where workspace_id = %s",
        (scope_id,),
    ).fetchone()
    return None if row is None or row[0] is None else str(row[0])


def prepare_review_data(
    conn: psycopg.Connection,
    scope_id: str,
    observations: list[dict[str, str | float]],
) -> dict[str, object]:
    """Run only checked member-scoped RPCs and prove the current pointer stayed put."""
    pointer_before = _current_pointer(conn, scope_id)
    owner = conn.execute(
        "select memberships.user_id "
        "from public.memberships "
        "join public.projects on projects.org_id = memberships.org_id "
        "join public.workspaces on workspaces.project_id = projects.project_id "
        "where workspaces.workspace_id = %s and memberships.role = 'owner' "
        "order by memberships.user_id limit 1",
        (scope_id,),
    ).fetchone()
    if owner is None:
        raise ValueError("The local review workspace does not have an owner.")
    user_id = owner[0]

    conn.execute("set role authenticated")
    conn.execute(
        "select set_config('request.jwt.claims', %s, false)",
        (json.dumps({"sub": str(user_id), "role": "authenticated"}),),
    )
    imported = conn.execute(
        "select metric_id, metric_name, created, accepted_rows, inserted_rows, "
        "updated_rows, start_date, end_date "
        "from public.import_workspace_metric_csv_v1(%s, %s, 'percent', %s::jsonb, %s)",
        (scope_id, METRIC_NAME, json.dumps(observations), user_id),
    ).fetchone()
    if imported is None:
        raise RuntimeError("The checked metric import returned no result.")

    selected: list[str] = []
    for metric_name in CORE_METRIC_NAMES:
        metric = conn.execute(
            "select metric_id from public.metrics "
            "where scope_id = %s and name = %s and granularity = 'daily'",
            (scope_id, metric_name),
        ).fetchone()
        if metric is None:
            raise ValueError(f"The populated demo metric {metric_name!r} is unavailable.")
        conn.execute(
            "select * from public.set_workspace_core_metric_v1(%s, %s, true, %s)",
            (scope_id, metric[0], user_id),
        ).fetchone()
        selected.append(metric_name)

    pointer_after = _current_pointer(conn, scope_id)
    if pointer_after != pointer_before:
        raise RuntimeError("Review data setup changed the current report series pointer.")
    conn.commit()
    return {
        "metric_id": str(imported[0]),
        "metric_name": imported[1],
        "created": imported[2],
        "accepted_rows": imported[3],
        "inserted_rows": imported[4],
        "updated_rows": imported[5],
        "start_date": imported[6].isoformat(),
        "end_date": imported[7].isoformat(),
        "core_metrics": selected,
        "current_series_unchanged": True,
    }


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scope", default=DEFAULT_SCOPE)
    parser.add_argument(
        "--csv",
        type=Path,
        default=repo_root / "test-fixtures" / "northstar-support-full-loop.csv",
    )
    args = parser.parse_args(argv)

    dsn = require_local_database(os.environ.get("DATABASE_URL", DEFAULT_DSN))
    observations = load_observations(args.csv.resolve())
    with psycopg.connect(dsn) as conn:
        summary = prepare_review_data(conn, args.scope, observations)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
