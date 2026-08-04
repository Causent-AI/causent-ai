"""Authenticated stateful endpoint for queued causal recomputation.

Unlike the credential-free engine endpoint, this function owns a Postgres DSN.
The private queue chooses the target and the worker switches to the job's stored
actor before any graph read/write. Request scope/metric values are filters only;
they can never redirect a job to a client-selected report or action set.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
from collections import Counter
from http.server import BaseHTTPRequestHandler
from uuid import UUID

_ENGINE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "engine"))
if _ENGINE_DIR not in sys.path:
    sys.path.insert(0, _ENGINE_DIR)

from persistence.recompute import RecomputeResult, drain_recompute_jobs  # noqa: E402

SECRET_HEADER = "x-causent-recompute-secret"
MAX_BODY_BYTES = 5_000
MAX_RESULT_ROWS = 20


class _BadRequest(Exception):
    pass


class _WorkerConfigurationError(Exception):
    pass


def _secret_ok(provided: str | None) -> bool:
    expected = os.environ.get("CAUSENT_RECOMPUTE_SECRET", "")
    return bool(expected) and hmac.compare_digest(str(provided or ""), expected)


def _optional_uuid(value: object, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise _BadRequest(f"`{field}` must be a UUID string")
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise _BadRequest(f"`{field}` must be a valid UUID") from exc


def _parse_body(raw_body: bytes) -> tuple[int, str | None, str | None]:
    if not raw_body:
        return 10, None, None
    try:
        payload = json.loads(raw_body)
    except (TypeError, ValueError) as exc:
        raise _BadRequest("invalid JSON body") from exc
    if not isinstance(payload, dict):
        raise _BadRequest("body must be a JSON object")
    unknown = set(payload) - {"limit", "scope_id", "metric_id"}
    if unknown:
        raise _BadRequest("body contains unsupported fields")
    limit = payload.get("limit", 10)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20:
        raise _BadRequest("`limit` must be an integer from 1 to 20")
    return (
        limit,
        _optional_uuid(payload.get("scope_id"), "scope_id"),
        _optional_uuid(payload.get("metric_id"), "metric_id"),
    )


def _database_url() -> str:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        raise _WorkerConfigurationError("DATABASE_URL_MISSING")
    return dsn


def _structured_log(event: str, **fields: object) -> None:
    """Emit bounded operator metadata only; never log request bodies or env values."""
    print(
        json.dumps({"service": "causent-recompute", "event": event, **fields}, sort_keys=True),
        file=sys.stderr,
        flush=True,
    )


def _default_drain(limit: int, scope_id: str | None, metric_id: str | None):
    dsn = _database_url()
    import psycopg

    conn = psycopg.connect(dsn)
    conn.autocommit = False
    try:
        return drain_recompute_jobs(
            conn, limit=limit, scope_id=scope_id, metric_id=metric_id
        )
    finally:
        conn.close()


def _summarize(results: list[RecomputeResult]) -> dict:
    counts = Counter(result.status for result in results)
    failed = counts.get("FAILED", 0)
    return {
        "ok": failed == 0,
        "processed": counts.get("PROCESSED", 0),
        "unchanged": counts.get("UNCHANGED", 0),
        "superseded": counts.get("SUPERSEDED", 0),
        "retry_scheduled": counts.get("RETRY_SCHEDULED", 0),
        "failed": failed,
        "total": len(results),
        "results": [
            {
                "activation_id": str(result.activation_id),
                "generation": result.generation,
                "status": result.status,
                "detail": result.detail,
            }
            for result in results[:MAX_RESULT_ROWS]
        ],
        "truncated": len(results) > MAX_RESULT_ROWS,
    }


def handle_request(
    raw_body: bytes | str | None,
    provided_secret: str | None,
    *,
    drain=_default_drain,
) -> tuple[int, dict]:
    if not _secret_ok(provided_secret):
        return 401, {"error": "unauthorized"}
    if raw_body is None:
        raw_body = b""
    if isinstance(raw_body, str):
        raw_body = raw_body.encode("utf-8")
    if len(raw_body) > MAX_BODY_BYTES:
        return 413, {"error": f"request body exceeds {MAX_BODY_BYTES} bytes"}
    try:
        limit, scope_id, metric_id = _parse_body(raw_body)
    except _BadRequest as exc:
        return 400, {"error": str(exc)}
    try:
        _database_url()
    except _WorkerConfigurationError as exc:
        _structured_log(
            "worker_config_invalid",
            status=503,
            error_code=str(exc),
        )
        return 503, {"error": "worker not configured", "detail": str(exc)}
    try:
        results = drain(limit, scope_id, metric_id)
    except Exception as exc:  # non-sensitive operational class only
        _structured_log(
            "request_failed",
            status=500,
            error_code=type(exc).__name__,
        )
        return 500, {"error": "causal recompute failed", "detail": type(exc).__name__}
    summary = _summarize(results)
    if summary["failed"]:
        _structured_log(
            "terminal_jobs_failed",
            status=500,
            failed=summary["failed"],
            retry_scheduled=summary["retry_scheduled"],
            total=summary["total"],
        )
        return 500, summary
    return 200, summary


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY_BYTES:
            self._respond(413, {"error": f"request body exceeds {MAX_BODY_BYTES} bytes"})
            return
        raw = self.rfile.read(length) if length else b""
        status, body = handle_request(raw, self.headers.get(SECRET_HEADER))
        self._respond(status, body)

    def do_GET(self) -> None:  # noqa: N802
        self._respond(405, {"error": "method not allowed; POST JSON to this endpoint"})

    def _respond(self, status: int, obj: dict) -> None:
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args) -> None:
        pass
