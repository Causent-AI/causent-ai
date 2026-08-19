"""Pure guard and serialization tests for api/recompute.py."""

from __future__ import annotations

import importlib.util
import json
import pathlib
from uuid import UUID

import pytest

from persistence.recompute import RecomputeResult

API_FILE = pathlib.Path(__file__).resolve().parents[2] / "api" / "recompute.py"
SPEC = importlib.util.spec_from_file_location("recompute_api", API_FILE)
assert SPEC and SPEC.loader
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)

SECRET = "recompute-test-secret"
SCOPE = "ca5e0000-0000-0000-0000-000000000071"
METRIC = "ca5e0000-0000-0000-0000-000000000073"
ACTIVATION = UUID("ca5e0000-0000-0000-0000-000000000075")
DATABASE_URL = (
    "postgresql://causent_recompute_worker.abcdefghijklmnopqrst:test-password@"
    "aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
)


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("CAUSENT_RECOMPUTE_SECRET", SECRET)
    monkeypatch.setenv("DATABASE_URL", DATABASE_URL)


def test_fails_closed_before_drain(monkeypatch):
    called = False

    def drain(*_):
        nonlocal called
        called = True
        return []

    assert api.handle_request(b"{}", "wrong", drain=drain)[0] == 401
    monkeypatch.delenv("CAUSENT_RECOMPUTE_SECRET")
    assert api.handle_request(b"{}", SECRET, drain=drain)[0] == 401
    assert called is False


def test_requires_explicit_database_url_after_auth(monkeypatch, capsys):
    called = False

    def drain(*_):
        nonlocal called
        called = True
        return []

    monkeypatch.delenv("DATABASE_URL")
    status, body = api.handle_request(b"{}", SECRET, drain=drain)
    assert status == 503
    assert body == {"error": "worker not configured", "detail": "DATABASE_URL_MISSING"}
    assert called is False
    log = json.loads(capsys.readouterr().err)
    assert log == {
        "error_code": "DATABASE_URL_MISSING",
        "event": "worker_config_invalid",
        "service": "causent-recompute",
        "status": 503,
    }

    with pytest.raises(api._WorkerConfigurationError):
        api._default_drain(1, None, None)


def test_rejects_wrong_database_role_before_drain(monkeypatch, capsys):
    called = False

    def drain(*_):
        nonlocal called
        called = True
        return []

    monkeypatch.setenv(
        "DATABASE_URL",
        DATABASE_URL.replace("causent_recompute_worker", "causent_resolve_worker"),
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


def test_passes_filters_and_summarizes_without_exposing_credentials():
    calls = []

    def drain(limit, scope_id, metric_id):
        calls.append((limit, scope_id, metric_id))
        return [
            RecomputeResult(ACTIVATION, 3, "PROCESSED", "graph materialized"),
            RecomputeResult(ACTIVATION, 4, "UNCHANGED", "input hash already processed"),
        ]

    status, body = api.handle_request(
        json.dumps({"limit": 2, "scope_id": SCOPE, "metric_id": METRIC}),
        SECRET,
        drain=drain,
    )
    assert status == 200
    assert calls == [(2, SCOPE, METRIC)]
    assert body["processed"] == 1
    assert body["unchanged"] == 1
    assert SECRET not in json.dumps(body)


def test_terminal_job_failures_are_non_2xx_and_structurally_logged(capsys):
    status, body = api.handle_request(
        b"{}",
        SECRET,
        drain=lambda *_: [
            RecomputeResult(ACTIVATION, 8, "FAILED", "RuntimeError"),
        ],
    )
    assert status == 500
    assert body["ok"] is False
    assert body["failed"] == 1
    assert body["total"] == 1
    log_text = capsys.readouterr().err
    log = json.loads(log_text)
    assert log == {
        "event": "terminal_jobs_failed",
        "failed": 1,
        "retry_scheduled": 0,
        "service": "causent-recompute",
        "status": 500,
        "total": 1,
    }
    assert str(ACTIVATION) not in log_text
    assert SECRET not in log_text


def test_driver_fault_returns_only_exception_class(capsys):
    def boom(*_):
        raise RuntimeError("postgresql://secret@host")

    status, body = api.handle_request(b"{}", SECRET, drain=boom)
    assert status == 500
    assert body == {"error": "causal recompute failed", "detail": "RuntimeError"}
    log_text = capsys.readouterr().err
    assert "postgresql://secret@host" not in log_text
    assert SECRET not in log_text
    assert json.loads(log_text) == {
        "error_code": "RuntimeError",
        "event": "request_failed",
        "service": "causent-recompute",
        "status": 500,
    }
