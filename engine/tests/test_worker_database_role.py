"""Catalog-level least-privilege contracts for stateful worker identities.

The source migration creates passwordless NOLOGIN roles. Release operations may
later attach generated credentials, but must not widen role memberships or
object grants. These probes enumerate both direct ACLs and effective access so
an inherited service-role grant or access to a second private queue fails closed.
"""

from __future__ import annotations

import psycopg

DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

WORKER_ROLES = (
    "causent_drift_worker",
    "causent_recompute_worker",
    "causent_resolve_worker",
)

EXPECTED_DIRECT_TABLE_PRIVILEGES = {
    ("causent_drift_worker", "private", "drift_refresh_jobs", "SELECT"),
    ("causent_drift_worker", "private", "drift_refresh_jobs", "UPDATE"),
    ("causent_drift_worker", "public", "actions", "SELECT"),
    ("causent_drift_worker", "public", "current_prediction_drift", "DELETE"),
    ("causent_drift_worker", "public", "current_prediction_drift", "INSERT"),
    ("causent_drift_worker", "public", "current_prediction_drift", "SELECT"),
    ("causent_drift_worker", "public", "decision_report_activations", "SELECT"),
    (
        "causent_drift_worker",
        "public",
        "decision_report_package_interventions",
        "SELECT",
    ),
    ("causent_drift_worker", "public", "decision_report_series", "SELECT"),
    ("causent_drift_worker", "public", "decision_reports", "SELECT"),
    ("causent_drift_worker", "public", "decisions", "SELECT"),
    ("causent_drift_worker", "public", "levers", "SELECT"),
    ("causent_drift_worker", "public", "metric_observations", "SELECT"),
    ("causent_drift_worker", "public", "metrics", "SELECT"),
    ("causent_drift_worker", "public", "predictions", "SELECT"),
    ("causent_drift_worker", "public", "workspaces", "SELECT"),
    (
        "causent_recompute_worker",
        "private",
        "causal_recompute_jobs",
        "SELECT",
    ),
    (
        "causent_recompute_worker",
        "private",
        "causal_recompute_jobs",
        "UPDATE",
    ),
    ("causent_recompute_worker", "public", "decision_report_activations", "SELECT"),
    (
        "causent_recompute_worker",
        "public",
        "decision_report_package_interventions",
        "SELECT",
    ),
    ("causent_recompute_worker", "public", "decision_report_series", "SELECT"),
    ("causent_recompute_worker", "public", "decision_reports", "SELECT"),
    ("causent_recompute_worker", "public", "memberships", "SELECT"),
    ("causent_recompute_worker", "public", "projects", "SELECT"),
    ("causent_recompute_worker", "public", "workspaces", "SELECT"),
}

EXPECTED_EFFECTIVE_TABLE_PRIVILEGES = EXPECTED_DIRECT_TABLE_PRIVILEGES

EXPECTED_LOCK_COLUMNS = {
    ("decision_report_activations", "activation_id", "UPDATE"),
    ("decision_report_series", "series_id", "UPDATE"),
    ("decision_reports", "report_id", "UPDATE"),
    ("workspaces", "workspace_id", "UPDATE"),
}


def _superuser_conn() -> psycopg.Connection:
    conn = psycopg.connect(DSN)
    conn.autocommit = True
    return conn


def test_worker_roles_are_passwordless_nologin_with_bounded_attributes():
    with _superuser_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select role.rolname, role.rolinherit, role.rolbypassrls, "
            "role.rolsuper, role.rolcreatedb, role.rolcreaterole, "
            "role.rolreplication, role.rolcanlogin, auth.rolpassword is null "
            "from pg_catalog.pg_roles as role "
            "join pg_catalog.pg_authid as auth on auth.oid = role.oid "
            "where role.rolname = any(%s) order by role.rolname",
            (list(WORKER_ROLES),),
        )
        attributes = cur.fetchall()

    assert attributes == [
        ("causent_drift_worker", False, True, False, False, False, False, False, True),
        (
            "causent_recompute_worker",
            False,
            True,
            False,
            False,
            False,
            False,
            False,
            True,
        ),
        (
            "causent_resolve_worker",
            False,
            False,
            False,
            False,
            False,
            False,
            False,
            True,
        ),
    ]


def test_worker_memberships_are_authenticated_set_only_and_never_service_role():
    with _superuser_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select member.rolname, parent.rolname, membership.admin_option, "
            "membership.inherit_option, membership.set_option "
            "from pg_catalog.pg_auth_members as membership "
            "join pg_catalog.pg_roles as parent on parent.oid = membership.roleid "
            "join pg_catalog.pg_roles as member on member.oid = membership.member "
            "where member.rolname = any(%s) "
            "order by member.rolname, parent.rolname",
            (list(WORKER_ROLES),),
        )
        memberships = cur.fetchall()

        effective_memberships = {}
        for worker in WORKER_ROLES:
            cur.execute(
                "select "
                "pg_catalog.pg_has_role(%s, 'service_role', 'MEMBER'), "
                "pg_catalog.pg_has_role(%s, 'service_role', 'USAGE'), "
                "pg_catalog.pg_has_role(%s, 'service_role', 'SET'), "
                "pg_catalog.pg_has_role(%s, 'authenticated', 'MEMBER'), "
                "pg_catalog.pg_has_role(%s, 'authenticated', 'USAGE'), "
                "pg_catalog.pg_has_role(%s, 'authenticated', 'SET')",
                (worker, worker, worker, worker, worker, worker),
            )
            effective_memberships[worker] = cur.fetchone()

    assert memberships == [
        ("causent_recompute_worker", "authenticated", False, False, True),
        ("causent_resolve_worker", "authenticated", False, False, True),
    ]
    assert effective_memberships == {
        "causent_drift_worker": (False, False, False, False, False, False),
        "causent_recompute_worker": (False, False, False, True, False, True),
        "causent_resolve_worker": (False, False, False, True, False, True),
    }


def test_worker_direct_schema_grants_are_exact():
    with _superuser_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select grantee.rolname, namespace.nspname, acl.privilege_type "
            "from pg_catalog.pg_namespace as namespace "
            "cross join lateral pg_catalog.aclexplode(namespace.nspacl) as acl "
            "join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee "
            "where grantee.rolname = any(%s) "
            "and namespace.nspname in ('auth', 'private', 'public', 'storage') "
            "order by grantee.rolname, namespace.nspname, acl.privilege_type",
            (list(WORKER_ROLES),),
        )
        grants = cur.fetchall()

    assert grants == [
        ("causent_drift_worker", "private", "USAGE"),
        ("causent_drift_worker", "public", "USAGE"),
        ("causent_recompute_worker", "private", "USAGE"),
        ("causent_recompute_worker", "public", "USAGE"),
    ]


def test_worker_effective_nonpublic_schema_access_is_exact():
    actual = set()
    with _superuser_conn() as conn, conn.cursor() as cur:
        for worker in WORKER_ROLES:
            cur.execute(
                "select %s, schema_name, privilege.name "
                "from unnest(array['auth', 'private', 'storage']) as schema_name "
                "cross join unnest(array['USAGE', 'CREATE']) as privilege(name) "
                "where pg_catalog.has_schema_privilege(%s, schema_name, privilege.name)",
                (worker, worker),
            )
            actual.update(cur.fetchall())

    assert actual == {
        ("causent_drift_worker", "private", "USAGE"),
        ("causent_recompute_worker", "private", "USAGE"),
    }


def test_worker_direct_table_grants_are_exact():
    with _superuser_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select grantee.rolname, namespace.nspname, relation.relname, "
            "acl.privilege_type "
            "from pg_catalog.pg_class as relation "
            "join pg_catalog.pg_namespace as namespace "
            "on namespace.oid = relation.relnamespace "
            "cross join lateral pg_catalog.aclexplode(relation.relacl) as acl "
            "join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee "
            "where grantee.rolname = any(%s) "
            "and namespace.nspname in ('auth', 'private', 'public', 'storage') "
            "and relation.relkind in ('r', 'p', 'v', 'm', 'f') "
            "order by grantee.rolname, namespace.nspname, relation.relname, "
            "acl.privilege_type",
            (list(WORKER_ROLES),),
        )
        actual = set(cur.fetchall())

    assert actual == EXPECTED_DIRECT_TABLE_PRIVILEGES, (
        "worker direct table grant drift: "
        f"unexpected={sorted(actual - EXPECTED_DIRECT_TABLE_PRIVILEGES)}, "
        f"missing={sorted(EXPECTED_DIRECT_TABLE_PRIVILEGES - actual)}"
    )


def test_worker_effective_table_access_is_exact_and_excludes_auth_storage():
    actual = set()
    with _superuser_conn() as conn, conn.cursor() as cur:
        for worker in WORKER_ROLES:
            cur.execute(
                "select %s, namespace.nspname, relation.relname, privilege.name "
                "from pg_catalog.pg_class as relation "
                "join pg_catalog.pg_namespace as namespace "
                "on namespace.oid = relation.relnamespace "
                "cross join unnest(array["
                "'SELECT','INSERT','UPDATE','DELETE','TRUNCATE',"
                "'REFERENCES','TRIGGER','MAINTAIN'"
                "]) as privilege(name) "
                "where namespace.nspname in ('auth', 'private', 'public', 'storage') "
                "and relation.relkind in ('r', 'p', 'v', 'm', 'f') "
                "and pg_catalog.has_table_privilege(%s, relation.oid, privilege.name)",
                (worker, worker),
            )
            actual.update(cur.fetchall())

    assert actual == EXPECTED_EFFECTIVE_TABLE_PRIVILEGES, (
        "worker effective table access drift: "
        f"unexpected={sorted(actual - EXPECTED_EFFECTIVE_TABLE_PRIVILEGES)}, "
        f"missing={sorted(EXPECTED_EFFECTIVE_TABLE_PRIVILEGES - actual)}"
    )


def test_recompute_lock_updates_are_limited_to_primary_key_columns():
    with _superuser_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select relation.relname, attribute.attname, acl.privilege_type "
            "from pg_catalog.pg_attribute as attribute "
            "join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid "
            "join pg_catalog.pg_namespace as namespace "
            "on namespace.oid = relation.relnamespace "
            "cross join lateral pg_catalog.aclexplode(attribute.attacl) as acl "
            "join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee "
            "where namespace.nspname = 'public' "
            "and grantee.rolname = 'causent_recompute_worker' "
            "order by relation.relname, attribute.attname, acl.privilege_type"
        )
        actual = set(cur.fetchall())

    assert actual == EXPECTED_LOCK_COLUMNS, (
        "recompute column grants must exist only for canonical row locks; "
        f"got {sorted(actual)}"
    )


def test_recompute_primary_key_column_grants_authorize_required_row_locks():
    with _superuser_conn() as conn, conn.cursor() as cur:
        granted_for_probe = False
        try:
            # The local Supabase `postgres` login is intentionally not a true
            # superuser, so give it a SET-only probe membership and remove it
            # before returning. The worker's own membership graph is unchanged.
            cur.execute(
                "grant causent_recompute_worker to postgres "
                "with admin false, inherit false, set true"
            )
            granted_for_probe = True
            cur.execute("set role causent_recompute_worker")
            cur.execute(
                "select report_id from public.decision_reports where false for update"
            )
            cur.execute(
                "select series_id from public.decision_report_series where false for update"
            )
            cur.execute(
                "select workspace_id from public.workspaces where false for update"
            )
            cur.execute(
                "select activation_id from public.decision_report_activations "
                "where false for update"
            )
        finally:
            cur.execute("reset role")
            if granted_for_probe:
                cur.execute("revoke causent_recompute_worker from postgres")
