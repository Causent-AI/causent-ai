"""Run the authenticated hot-read EXPLAIN contract against local Supabase."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg


REPO_ROOT = Path(__file__).resolve().parent.parent
PLAN_FILE = REPO_ROOT / "scripts" / "query-plans" / "hot-read-paths.sql"
LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"


def main() -> None:
    dsn = os.environ.get("CAUSENT_LOCAL_DATABASE_URL", LOCAL_DSN)
    sql = PLAN_FILE.read_text(encoding="utf-8")

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            # psycopg uses the simple-query protocol for this parameter-free
            # multi-statement file. That preserves one session for SET LOCAL,
            # RLS claims, all EXPLAINs, and the final rollback.
            cursor.execute(sql)
            result_number = 0
            while True:
                if cursor.description is not None:
                    rows = cursor.fetchall()
                    if rows:
                        result_number += 1
                        print(f"\n--- query plan {result_number} ---")
                        for row in rows:
                            print("\t".join(str(value) for value in row))
                if not cursor.nextset():
                    break


if __name__ == "__main__":
    main()
