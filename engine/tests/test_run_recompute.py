import pytest

from persistence.run_recompute import require_local_database


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "postgresql://postgres:postgres@localhost:54322/postgres",
        "postgresql://postgres:postgres@[::1]:54322/postgres",
    ],
)
def test_require_local_database_accepts_loopback_hosts(dsn: str) -> None:
    assert require_local_database(dsn) == dsn


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://postgres:secret@db.example.com/postgres",
        "postgresql://postgres:secret@10.0.0.12/postgres",
        "postgresql:///postgres",
    ],
)
def test_require_local_database_rejects_remote_or_implicit_hosts(dsn: str) -> None:
    with pytest.raises(ValueError, match="loopback DATABASE_URL"):
        require_local_database(dsn)
