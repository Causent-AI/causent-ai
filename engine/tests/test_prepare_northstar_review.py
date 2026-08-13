from pathlib import Path

import pytest

from persistence.prepare_northstar_review import (
    load_observations,
    require_local_database,
)


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "postgresql://postgres:postgres@localhost:54322/postgres",
        "postgresql://postgres:postgres@[::1]:54322/postgres",
    ],
)
def test_require_local_database_accepts_loopback(dsn: str) -> None:
    assert require_local_database(dsn) == dsn


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://db.example.com/postgres",
        "postgresql:///postgres",
        "postgresql://10.0.0.4/postgres",
    ],
)
def test_require_local_database_rejects_remote_or_implicit_hosts(dsn: str) -> None:
    with pytest.raises(ValueError, match="loopback"):
        require_local_database(dsn)


def test_northstar_fixture_has_complete_unique_daily_observations() -> None:
    fixture = (
        Path(__file__).resolve().parents[2]
        / "test-fixtures"
        / "northstar-support-full-loop.csv"
    )
    observations = load_observations(fixture)
    assert len(observations) == 122
    assert observations[0]["date"] == "2026-04-01"
    assert observations[-1]["date"] == "2026-07-31"
    assert len({row["date"] for row in observations}) == len(observations)
