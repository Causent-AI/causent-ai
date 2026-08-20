"""Pure guard and serialization tests for api/drift.py."""

from __future__ import annotations

import importlib.util
import json
import pathlib
from uuid import UUID

import pytest

from persistence.drift_materialization import DriftRefreshResult

API_FILE = pathlib.Path(__file__).resolve().parents[2] / "api" / "drift.py"
SPEC = importlib.util.spec_from_file_location("drift_api", API_FILE)
assert SPEC and SPEC.loader
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)

SECRET = "drift-test-secret"
SCOPE = "ca5e0000-0000-0000-0000-000000000071"
SCOPE_UUID = UUID(SCOPE)
DATABASE_URL = (
    "postgresql://causent_drift_worker.abcdefghijklmnopqrst:test-password@"
    "aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
)


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("CAUSENT_DRIFT_SECRET", SECRET)
    monkeypatch.setenv("DATABASE_URL", DATABASE_URL)


def test_fails_closed_before_drain(monkeypatch):
    called = False

    def drain(*_):
        nonlocal called
        called = True
        return []

    assert api.handle_request(b"{}", "wrong", drain=drain)[0] == 401
    monkeypatch.delenv("CAUSENT_DRIFT_SECRET")
    assert api.handle_request(b"{}", SECRET, drain=drain)[0] == 401
    assert called is False


def test_requires_explicit_database_url_after_auth(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL")
    status, body = api.handle_request(b"{}", SECRET, drain=lambda *_: [])
    assert status == 503
    assert body == {"error": "worker not configured", "detail": "DATABASE_URL_MISSING"}
    assert json.loads(capsys.readouterr().err) == {
        "error_code": "DATABASE_URL_MISSING",
        "event": "worker_config_invalid",
        "service": "causent-drift",
        "status": 503,
    }


def test_rejects_wrong_database_role_before_drain(monkeypatch, capsys):
    called = False

    def drain(*_):
        nonlocal called
        called = True
        return []

    monkeypatch.setenv(
        "DATABASE_URL",
        DATABASE_URL.replace("causent_drift_worker", "causent_recompute_worker"),
    )
    status, body = api.handle_request(b"{}", SECRET, drain=drain)
    assert status == 503
    assert body == {"error": "worker not configured", "detail": "DATABASE_URL_INVALID"}
    assert called is False
    assert "test-password" not in capsys.readouterr().err


@pytest.mark.parametrize(
    "body",
    [b"{", b"[]", b'{"limit":0}', b'{"limit":true}', b'{"scope_id":"bad"}', b'{"extra":1}'],
)
def test_rejects_malformed_or_forged_filters(body):
    assert api.handle_request(body, SECRET, drain=lambda *_: [])[0] == 400


def test_passes_bounded_filter_and_summarizes_without_credentials():
    calls = []

    def drain(limit, scope_id):
        calls.append((limit, scope_id))
        return [
            DriftRefreshResult(
                SCOPE_UUID,
                3,
                "PROCESSED",
                "current drift materialized",
            )
        ]

    status, body = api.handle_request(
        json.dumps({"limit": 1, "scope_id": SCOPE}),
        SECRET,
        drain=drain,
    )
    assert status == 200
    assert calls == [(1, SCOPE)]
    assert body["processed"] == 1
    assert body["superseded"] == 0
    assert body["total"] == 1
    assert SECRET not in json.dumps(body)


def test_terminal_failure_is_non_2xx_and_log_omits_scope(capsys):
    status, body = api.handle_request(
        b"{}",
        SECRET,
        drain=lambda *_: [
            DriftRefreshResult(SCOPE_UUID, 8, "FAILED", "RuntimeError")
        ],
    )
    assert status == 500
    assert body["ok"] is False
    assert body["failed"] == 1
    log_text = capsys.readouterr().err
    assert json.loads(log_text) == {
        "event": "terminal_jobs_failed",
        "failed": 1,
        "retry_scheduled": 0,
        "service": "causent-drift",
        "status": 500,
        "total": 1,
    }
    assert SCOPE not in log_text
    assert SECRET not in log_text


def test_driver_fault_returns_only_exception_class(capsys):
    def boom(*_):
        raise RuntimeError("postgresql://secret@host")

    status, body = api.handle_request(b"{}", SECRET, drain=boom)
    assert status == 500
    assert body == {"error": "drift refresh failed", "detail": "RuntimeError"}
    log_text = capsys.readouterr().err
    assert "postgresql://secret@host" not in log_text
    assert SECRET not in log_text
