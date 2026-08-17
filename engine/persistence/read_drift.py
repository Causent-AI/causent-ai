"""Local diagnostic CLI for a scope's unresolved baseline-drift inputs.

The dashboard does not call this file. Production reads the checked current
projection while ``drift_materialization.py`` owns asynchronous engine work.
This command remains a developer-only way to inspect the pure detector through
an RLS-scoped connection without writing the projection.

Run:
    cd engine && .venv/bin/python persistence/read_drift.py
    # honors $DATABASE_URL; defaults to the local stack DSN.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import date

import psycopg

# Importable as `python persistence/read_drift.py` or `python -m persistence.read_drift`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from causal.types import DriftResult  # noqa: E402
from persistence.drift_read import read_scope_drift  # noqa: E402
from persistence.run_resolution import _connect_as_user, _demo_owner  # noqa: E402
from persistence.seed_demo import DSN, SCOPE  # noqa: E402


def _to_json(drift: DriftResult) -> dict:
    """Serialize a DriftResult for the TS read layer. shift_ordinal -> ISO date."""
    shift_date = (
        date.fromordinal(drift.shift_ordinal).isoformat()
        if drift.shift_ordinal is not None
        else None
    )
    return {
        "status": drift.status,
        "reason": drift.reason,
        "shiftDate": shift_date,
        "preLevel": drift.pre_level,
        "postLevel": drift.post_level,
        "deltaNative": drift.delta_native,
        "pctChange": drift.pct_change,
        "direction": drift.direction,
        "ciLow": drift.ci_low,
        "ciHigh": drift.ci_high,
        "nPre": drift.n_pre,
        "nPost": drift.n_post,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scope", default=str(SCOPE))
    parser.add_argument("--user", default=None, help="acting user uuid (default: demo owner)")
    args = parser.parse_args(argv)

    if args.user:
        acting_user = uuid.UUID(args.user)
    else:
        lookup = psycopg.connect(DSN)
        lookup.autocommit = True
        try:
            acting_user = _demo_owner(lookup)
        finally:
            lookup.close()

    conn = _connect_as_user(acting_user)
    try:
        drift = read_scope_drift(conn, args.scope)
    finally:
        conn.close()

    json.dump({pid: _to_json(d) for pid, d in drift.items()}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
