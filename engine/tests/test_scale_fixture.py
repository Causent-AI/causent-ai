from uuid import UUID

import pytest

from persistence.scale_fixture import (
    PROFILES,
    assert_apply_allowed,
    fixture_plan,
    is_local_dsn,
)


SCOPE = UUID("ca5e0000-0000-0000-0000-0000000000d3")


def test_gigabyte_plan_is_deterministic_and_explicitly_estimated():
    first = fixture_plan("gigabyte", SCOPE, "postgresql://postgres:postgres@localhost:54322/postgres")
    second = fixture_plan("gigabyte", SCOPE, "postgresql://postgres:postgres@localhost:54322/postgres")
    assert first == second
    assert first["observationRows"] == 15_000_000
    assert first["estimatedGiB"] >= 1
    assert first["estimateOnly"] is True


def test_remote_apply_requires_both_opt_ins(monkeypatch):
    remote = "postgresql://example.invalid/postgres"
    assert is_local_dsn(remote) is False
    with pytest.raises(ValueError, match="--allow-remote"):
        assert_apply_allowed(remote, "smoke", allow_remote=False, confirm_gigabyte=False)
    monkeypatch.delenv("CAUSENT_SCALE_FIXTURE_ALLOW", raising=False)
    with pytest.raises(ValueError, match="CAUSENT_SCALE_FIXTURE_ALLOW"):
        assert_apply_allowed(remote, "smoke", allow_remote=True, confirm_gigabyte=False)
    monkeypatch.setenv("CAUSENT_SCALE_FIXTURE_ALLOW", "staging")
    assert_apply_allowed(remote, "smoke", allow_remote=True, confirm_gigabyte=False)


def test_gigabyte_apply_has_an_independent_confirmation():
    with pytest.raises(ValueError, match="--confirm-gigabyte"):
        assert_apply_allowed(
            "postgresql://postgres:postgres@localhost:54322/postgres",
            "gigabyte",
            allow_remote=False,
            confirm_gigabyte=False,
        )
    assert PROFILES["steady"].observation_rows == 18_250
