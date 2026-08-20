"""Network-free worker DSN and deploy-preflight contracts."""

from __future__ import annotations

import pathlib

import pytest

from persistence.worker_runtime import (
    WorkerConfigurationError,
    require_worker_database_url,
)

PROJECT_REF = "abcdefghijklmnopqrst"
PASSWORD = "test-password"
HOST = "aws-0-us-west-1.pooler.supabase.com"
ROLES = (
    "causent_drift_worker",
    "causent_recompute_worker",
    "causent_resolve_worker",
)
REPO = pathlib.Path(__file__).resolve().parents[2]


def _dsn(role: str) -> str:
    return (
        f"postgresql://{role}.{PROJECT_REF}:{PASSWORD}@{HOST}:5432/"
        "postgres?sslmode=require"
    )


@pytest.mark.parametrize("role", ROLES)
def test_accepts_only_the_exact_role_scoped_supavisor_shape(role):
    dsn = _dsn(role)
    assert require_worker_database_url(f"  {dsn}  ", expected_role=role) == dsn
    assert require_worker_database_url(
        dsn.replace("postgresql://", "postgres://"),
        expected_role=role,
    ).startswith("postgres://")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda dsn: dsn.replace("causent_drift_worker", "postgres"),
        lambda dsn: dsn.replace("causent_drift_worker", "service_role"),
        lambda dsn: dsn.replace("causent_drift_worker", "causent_recompute_worker"),
        lambda dsn: dsn.replace(f".{PROJECT_REF}", ".shortref"),
        lambda dsn: dsn.replace("causent_drift_worker", "causent%5Fdrift%5Fworker"),
        lambda dsn: dsn.replace(f":{PASSWORD}@", "@"),
        lambda dsn: dsn.replace(HOST, "pooler.supabase.com.evil.example"),
        lambda dsn: dsn.replace(HOST, "localhost"),
        lambda dsn: dsn.replace(":5432/", ":6543/"),
        lambda dsn: dsn.replace(":5432/", "/"),
        lambda dsn: dsn.replace("/postgres?", "/other?"),
        lambda dsn: dsn.replace("?sslmode=require", ""),
        lambda dsn: dsn.replace("sslmode=require", "sslmode=prefer"),
        lambda dsn: f"{dsn}&application_name=causent",
        lambda dsn: f"{dsn}&sslmode=require",
        lambda dsn: dsn.replace(":5432/", ":not-a-port/"),
    ],
)
def test_rejects_every_privilege_or_transport_contract_mismatch(mutate):
    rejected = mutate(_dsn("causent_drift_worker"))
    with pytest.raises(WorkerConfigurationError, match="^DATABASE_URL_INVALID$") as error:
        require_worker_database_url(rejected, expected_role="causent_drift_worker")
    assert PASSWORD not in str(error.value)


def test_missing_database_url_has_a_distinct_non_sensitive_code():
    with pytest.raises(WorkerConfigurationError, match="^DATABASE_URL_MISSING$"):
        require_worker_database_url(None, expected_role="causent_drift_worker")


@pytest.mark.parametrize(
    ("script_name", "config_command"),
    [
        ("deploy-drift.sh", "npm run check:drift-config"),
        ("deploy-recompute.sh", "npm run check:recompute-config"),
        ("deploy-resolve.sh", "npm run check:resolve-config"),
    ],
)
def test_deploy_scripts_preflight_config_after_stage_only_and_before_network(
    script_name,
    config_command,
):
    source = (REPO / "scripts" / script_name).read_text()
    preflight = source.index(config_command)
    stage_only_guard = source.rindex("if (( STAGE_ONLY )); then", 0, preflight)
    stage_only_exit = source.index("exit 0", stage_only_guard, preflight)
    link = source.index('npx --yes "vercel@$VERCEL_CLI_VERSION" link')
    deploy = source.index('npx --yes "vercel@$VERCEL_CLI_VERSION" deploy')

    assert stage_only_guard < stage_only_exit < preflight < link < deploy
    assert source.count(config_command) == 1
    assert "worker_runtime.py" in source
