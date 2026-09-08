"""Real-login metric-definition and separate-customer boundaries (T08/T10)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import os
from uuid import uuid4

import psycopg
from psycopg import errors, sql
from psycopg.conninfo import conninfo_to_dict
import pytest


DSN = os.environ.get(
    "CAUSENT_TEST_DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)


@pytest.fixture(scope="module")
def tenant_fixture():
    users = [uuid4(), uuid4()]
    requests = [uuid4(), uuid4()]
    login_name = f"measurement_member_{uuid4().hex[:10]}"
    password = str(uuid4())
    with psycopg.connect(DSN, autocommit=True) as admin:
        for user in users:
            admin.execute("insert into auth.users(id) values(%s)", (user,))
        scopes = []
        for index, (request, owner) in enumerate(zip(requests, users)):
            scopes.append(
                admin.execute(
                    "select public.provision_customer_workspace_v1(%s,%s,%s,'Product','Support')",
                    (request, owner, f"Customer {index}"),
                ).fetchone()[0]
            )
        admin.execute(
            sql.SQL("create role {} login noinherit password {}").format(
                sql.Identifier(login_name), sql.Literal(password)
            )
        )
        admin.execute(
            sql.SQL("grant authenticated to {} with inherit false, set true").format(
                sql.Identifier(login_name)
            )
        )
        try:
            yield dict(
                admin=admin,
                users=users,
                requests=requests,
                scopes=scopes,
                login=login_name,
                password=password,
            )
        finally:
            organizations = [
                row[0]
                for row in admin.execute(
                    "delete from private.customer_provisioning_requests where request_id=any(%s) returning organization_id",
                    (requests,),
                ).fetchall()
            ]
            admin.execute(
                "delete from public.orgs where org_id=any(%s)", (organizations,)
            )
            admin.execute("delete from auth.users where id=any(%s)", (users,))
            admin.execute(sql.SQL("drop role {}").format(sql.Identifier(login_name)))


@contextmanager
def member(fixture, index=0):
    options = conninfo_to_dict(DSN)
    options.update(user=fixture["login"], password=fixture["password"])
    with psycopg.connect(**options, autocommit=True) as connection:
        connection.execute("set role authenticated")
        connection.execute(
            "select set_config('request.jwt.claims',%s,false)",
            (
                json.dumps(
                    {"sub": str(fixture["users"][index]), "role": "authenticated"}
                ),
            ),
        )
        yield connection


def test_customer_creation_is_exactly_idempotent_and_conflicts_are_visible(
    tenant_fixture,
):
    f = tenant_fixture
    request, owner, scope = f["requests"][0], f["users"][0], f["scopes"][0]
    args = (request, owner, "Customer 0", "Product", "Support")

    def retry(_):
        with psycopg.connect(DSN) as connection:
            connection.execute("set local role service_role")
            return connection.execute(
                "select public.provision_customer_workspace_v1(%s,%s,%s,%s,%s)", args
            ).fetchone()[0]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(retry, range(2))) == [scope, scope]
    for changed in [
        (request, f["users"][1], *args[2:]),
        (request, owner, "Changed", *args[3:]),
    ]:
        with pytest.raises(errors.UniqueViolation):
            f["admin"].execute(
                "select public.provision_customer_workspace_v1(%s,%s,%s,%s,%s)", changed
            )
    with member(f) as caller:
        assert caller.execute("select session_user").fetchone()[0] == f["login"]
        with pytest.raises(errors.InsufficientPrivilege):
            caller.execute(
                "select public.provision_customer_workspace_v1(%s,%s,%s,%s,%s)", args
            )


def test_missing_owner_rolls_back_every_provisioning_row(tenant_fixture):
    admin = tenant_fixture["admin"]
    counts = admin.execute(
        "select (select count(*) from public.orgs), (select count(*) from public.workspaces)"
    ).fetchone()
    with pytest.raises(errors.ForeignKeyViolation):
        admin.execute(
            "select public.provision_customer_workspace_v1(%s,%s,'Rejected','Product','Support')",
            (uuid4(), uuid4()),
        )
    assert (
        admin.execute(
            "select (select count(*) from public.orgs), (select count(*) from public.workspaces)"
        ).fetchone()
        == counts
    )


def test_separate_organizations_require_current_membership(tenant_fixture):
    f = tenant_fixture
    for index in (0, 1):
        with member(f, index) as caller:
            assert caller.execute(
                "select workspace_id from public.workspaces"
            ).fetchall() == [(f["scopes"][index],)]
            assert (
                caller.execute("select * from public.evaluation_runs").fetchall() == []
            )
            with pytest.raises(errors.InsufficientPrivilege):
                caller.execute(
                    "insert into public.metrics(scope_id,name,source,unit) values(%s,'Foreign','csv','count')",
                    (f["scopes"][1 - index],),
                )
    with f["admin"].transaction():
        f["admin"].execute(
            "delete from public.memberships where user_id=%s", (f["users"][1],)
        )
        # An independent connection sees the committed permission boundary below.
    with member(f, 1) as caller:
        assert (
            caller.execute("select workspace_id from public.workspaces").fetchall()
            == []
        )


def test_metric_definition_scale_scope_and_immutability(tenant_fixture):
    f = tenant_fixture
    with member(f) as caller:
        metric = caller.execute(
            "insert into public.metrics(scope_id,name,source,unit) values(%s,'Failure rate','csv','percent') returning metric_id",
            (f["scopes"][0],),
        ).fetchone()[0]
        caller.execute(
            "insert into public.metric_observations(metric_id,obs_date,value) values(%s,'2026-01-01',0.5)",
            (metric,),
        )
        assert caller.execute(
            "select percent_scale,readiness from public.list_decision_report_activation_metrics_v2(%s) where metric_id=%s",
            (f["scopes"][0], metric),
        ).fetchone() == ("unknown", "Confirm metric definition")
        args = (metric, f["scopes"][0], f["users"][0])
        caller.execute(
            "insert into public.metric_definitions(metric_id,scope_id,unit,numeric_scale,beneficial_direction,aggregation,denominator,confirmed_by) values(%s,%s,'percent','points','lower','rate','eligible requests',%s)",
            args,
        )
        assert (
            caller.execute(
                "select percent_scale from public.list_decision_report_activation_metrics_v2(%s) where metric_id=%s",
                (f["scopes"][0], metric),
            ).fetchone()[0]
            == "points"
        )
        with pytest.raises(errors.ObjectNotInPrerequisiteState):
            caller.execute(
                "update public.metrics set unit='count' where metric_id=%s", (metric,)
            )
        with pytest.raises(errors.InsufficientPrivilege):
            caller.execute(
                "update public.metric_definitions set numeric_scale='ratio' where metric_id=%s",
                (metric,),
            )
        with pytest.raises(errors.InsufficientPrivilege):
            caller.execute(
                "delete from public.metric_definitions where metric_id=%s", (metric,)
            )
        with pytest.raises(errors.InvalidParameterValue, match="Definition must match"):
            caller.execute(
                "insert into public.metric_definitions(metric_id,scope_id,unit,numeric_scale,beneficial_direction,aggregation,denominator,confirmed_by) values(%s,%s,'percent','points','lower','rate','forged',%s)",
                (uuid4(), f["scopes"][1], f["users"][0]),
            )


def test_archive_preserves_history_but_blocks_selection_and_ordinary_writes(
    tenant_fixture,
):
    f = tenant_fixture
    scope = f["scopes"][0]
    f["admin"].execute(
        "select public.set_customer_workspace_archived_v1(%s,true)", (scope,)
    )
    with member(f) as caller:
        assert (
            caller.execute(
                "select workspace_id from public.workspaces where archived_at is null"
            ).fetchall()
            == []
        )
        assert caller.execute(
            "select workspace_id from public.workspaces"
        ).fetchall() == [(scope,)]
        with pytest.raises(
            errors.ObjectNotInPrerequisiteState, match="Workspace is archived"
        ):
            caller.execute(
                "insert into public.metrics(scope_id,name,source,unit) values(%s,'Archived write','csv','count')",
                (scope,),
            )
        with pytest.raises(errors.InsufficientPrivilege):
            caller.execute(
                "select public.set_customer_workspace_archived_v1(%s,false)", (scope,)
            )
    # Connector credentials bypass RLS, so the source-table trigger must enforce
    # the same lifecycle boundary independently of the ordinary member policy.
    with psycopg.connect(DSN, autocommit=True) as connector:
        connector.execute("set role service_role")
        with pytest.raises(
            errors.ObjectNotInPrerequisiteState, match="Workspace is archived"
        ):
            connector.execute(
                "insert into public.actions(scope_id,source,external_ref,status) "
                "values(%s,'github','archived-connector-write','merged')",
                (scope,),
            )
    f["admin"].execute(
        "select public.set_customer_workspace_archived_v1(%s,false)", (scope,)
    )
    with member(f) as caller:
        assert caller.execute(
            "select workspace_id from public.workspaces where archived_at is null"
        ).fetchall() == [(scope,)]
