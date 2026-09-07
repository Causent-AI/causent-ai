"""Actual database, bridge and worker acceptance for T05–T09.

Historical fixtures represent a previously registered plan. Only the fixture
owner bypasses the wall-clock registration trigger to restore that history;
separate tests exercise real prospective enforcement through a member login.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import date, timedelta
from uuid import uuid4

import numpy as np
import psycopg
import pytest
import test_recompute_worker as seed
from persistence import measurement
from persistence.bridge import persist_metric_readouts
from persistence.recompute import process_next_recompute_job
from persistence.resolve import resolve_prediction
from psycopg import errors, sql
from psycopg.conninfo import conninfo_to_dict

TODAY = date(2026, 5, 2)


@pytest.fixture()
def fixture():
    admin = seed._connect()
    seed._seed(admin)
    password = str(uuid4())
    login = f"measurement_test_{uuid4().hex[:10]}"
    admin.execute(
        sql.SQL("create role {} login noinherit password {}").format(
            sql.Identifier(login), sql.Literal(password)
        )
    )
    admin.execute(
        sql.SQL("grant authenticated to {} with inherit false, set true").format(
            sql.Identifier(login)
        )
    )
    for role in ("causent_recompute_worker", "causent_resolve_worker"):
        admin.execute(
            sql.SQL("alter role {} login password {}").format(
                sql.Identifier(role), sql.Literal(password)
            )
        )
    admin.execute(
        "update public.metrics set unit='count' where metric_id=%s", (seed.METRIC,)
    )
    definition = admin.execute(
        "insert into public.metric_definitions(metric_id,scope_id,unit,numeric_scale,beneficial_direction,aggregation,denominator,confirmed_by) "
        "values(%s,%s,'count','native','higher','sum','eligible requests',%s) returning definition_id",
        (seed.METRIC, seed.SCOPE, seed.ACTOR),
    ).fetchone()[0]
    admin.commit()
    f = dict(admin=admin, definition=definition, login=login, password=password)
    try:
        yield f
    finally:
        admin.rollback()
        seed._teardown(admin)
        admin.execute(sql.SQL("drop role {}").format(sql.Identifier(login)))
        for role in ("causent_recompute_worker", "causent_resolve_worker"):
            admin.execute(
                sql.SQL("alter role {} nologin password null").format(
                    sql.Identifier(role)
                )
            )
        admin.commit()
        admin.close()


@contextmanager
def as_actor(f, worker=None):
    options = conninfo_to_dict(seed.DSN)
    options.update(user=worker or f["login"], password=f["password"])
    with psycopg.connect(**options) as conn:
        conn.execute("set local role authenticated")
        conn.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (json.dumps({"sub": str(seed.ACTOR), "role": "authenticated"}),),
        )
        yield conn


def install_plan(
    f, *, lag=0, concurrent="none_known", actual="2026-02-20", staged=False
):
    conn = f["admin"]
    conn.execute(
        "alter table public.measurement_plans disable trigger measurement_plan_prospective"
    )
    plan = conn.execute(
        "insert into public.measurement_plans(scope_id,activation_id,metric_id,definition_id,design,estimand,exposure_start,exposure_end,lag_days,window_start,window_end,exposure_source,population,concurrent_changes,concurrent_change_status,decision_threshold,registered_by,created_at) "
        "values(%s,%s,%s,%s,'observational_its','immediate_level_change','2026-02-20','2026-02-20',%s,'2026-01-01','2026-04-30','deployment:123','eligible requests','release calendar reviewed',%s,10,%s,'2025-12-31') returning plan_id",
        (
            seed.SCOPE,
            seed.ACTIVATION,
            seed.METRIC,
            f["definition"],
            lag,
            concurrent,
            seed.ACTOR,
        ),
    ).fetchone()[0]
    conn.execute(
        "alter table public.measurement_plans enable trigger measurement_plan_prospective"
    )
    if actual:
        for action in (seed.ACTION, seed.FINAL_ACTION):
            conn.execute(
                "insert into public.measurement_exposures(plan_id,action_id,scope_id,first_exposure,fully_exposed,source,recorded_by) "
                "values(%s,%s,%s,%s,%s,'deployment:123',%s)",
                (
                    plan,
                    action,
                    seed.SCOPE,
                    actual,
                    "2026-02-21" if staged else actual,
                    seed.ACTOR,
                ),
            )
    # Reproducible noise and step; raw statistical significance is a positive
    # control for the separate no-attribution claim below.
    rng = np.random.default_rng(503)
    with conn.cursor() as cursor:
        cursor.executemany(
            "update public.metric_observations set value=%s where metric_id=%s and obs_date=%s",
            [
                (
                    100 + float(rng.normal(0, 1)) + (35 if index >= 50 else 0),
                    seed.METRIC,
                    date(2026, 1, 1) + timedelta(days=index),
                )
                for index in range(120)
            ],
        )
    conn.commit()
    return plan


def evaluate(f, *, today=TODAY, role="causent_recompute_worker"):
    with as_actor(f, role) as conn:
        return persist_metric_readouts(
            conn,
            seed.SCOPE,
            seed.METRIC,
            activation_id=seed.ACTIVATION,
            action_ids=[seed.ACTION],
            today=today,
        )


def test_more_than_200_historical_actions_do_not_expand_registered_family(fixture):
    f = fixture
    install_plan(f)
    before, _ = evaluate(f)
    with f["admin"].cursor() as cur:
        cur.executemany(
            "insert into public.actions(scope_id,source,external_ref,effective_date,status) values(%s,'manual',%s,'2026-03-01','complete')",
            [(seed.SCOPE, f"historical-{index}") for index in range(250)],
        )
    f["admin"].commit()
    after, evaluation = evaluate(f)
    assert before.input_hash == after.input_hash
    assert after.manifest["family"]["hypotheses"] == 1
    assert len(after.manifest["actions"]) == 2
    record = (
        f["admin"]
        .execute(
            "select interpretation,refusal_reason from public.evaluation_runs where evaluation_id=%s",
            (evaluation,),
        )
        .fetchone()
    )
    assert record == ("observational", None)
    edge = (
        f["admin"]
        .execute(
            "select belief_score,lift from public.current_edge_readouts where evaluation_id=%s",
            (evaluation,),
        )
        .fetchone()
    )
    assert (
        edge[0] == 1 and edge[1] > 30
    )  # Valid statistical detection still cannot attribute work.
    assert (
        f["admin"]
        .execute(
            "select count(*) from public.current_edge_readouts where scope_id=%s",
            (seed.SCOPE,),
        )
        .fetchone()[0]
        == 1
    )


def test_fixed_horizon_withholds_early_looks_and_excludes_post_horizon_data(fixture):
    f = fixture
    install_plan(f)
    waiting, _ = evaluate(f, today=date(2026, 4, 30))
    assert waiting.refusal == "WAITING_FOR_FIXED_HORIZON" and waiting.resume_at == date(
        2026, 5, 1
    )
    ready, _ = evaluate(f)
    f["admin"].execute(
        "insert into public.metric_observations(metric_id,obs_date,value) values(%s,'2026-05-01',900000)",
        (seed.METRIC,),
    )
    f["admin"].commit()
    unchanged, _ = evaluate(f)
    assert ready.input_hash == unchanged.input_hash != waiting.input_hash
    f["admin"].execute(
        "update public.metric_observations set value=value+1 where metric_id=%s and obs_date='2026-04-30'",
        (seed.METRIC,),
    )
    f["admin"].commit()
    corrected, _ = evaluate(f)
    assert corrected.input_hash != ready.input_hash


def test_lag_excludes_treated_days_from_baseline(fixture):
    f = fixture
    install_plan(f, lag=5)
    inputs, _ = evaluate(f)
    days = {str(row[0]) for row in inputs.observations}
    assert inputs.refusal is None
    assert inputs.exposure_date == date(2026, 2, 25)
    assert "2026-02-19" in days and "2026-02-25" in days
    assert not any(f"2026-02-{day}" in days for day in range(20, 25))


@pytest.mark.parametrize(
    "changes,reason",
    [
        ({"concurrent": "present"}, "CONCURRENT_CHANGES_NOT_ISOLATED"),
        ({"concurrent": "unknown"}, "CONCURRENT_CHANGES_NOT_ISOLATED"),
        ({"actual": None}, "EXPOSURE_NOT_DOCUMENTED"),
        ({"actual": "2026-02-19"}, "EXPOSURE_DIFFERS_FROM_PLAN"),
        ({"staged": True}, "EXPOSURE_DIFFERS_FROM_PLAN"),
    ],
)
def test_unsupported_exposure_and_external_changes_refuse_attribution(
    fixture, changes, reason
):
    install_plan(fixture, **changes)
    inputs, evaluation = evaluate(fixture)
    assert inputs.refusal == reason
    assert (
        fixture["admin"]
        .execute(
            "select interpretation from public.evaluation_runs where evaluation_id=%s",
            (evaluation,),
        )
        .fetchone()[0]
        == "cannot_attribute"
    )
    assert (
        fixture["admin"]
        .execute(
            "select lift from public.current_edge_readouts where evaluation_id=%s",
            (evaluation,),
        )
        .fetchone()[0]
        is None
    )


def test_missing_day_refuses_instead_of_shortening_registered_window(fixture):
    install_plan(fixture)
    fixture["admin"].execute(
        "delete from public.metric_observations where metric_id=%s and obs_date='2026-01-10'",
        (seed.METRIC,),
    )
    fixture["admin"].commit()
    assert evaluate(fixture)[0].refusal == "FIXED_WINDOW_INCOMPLETE"


def test_policy_change_invalidates_identity_and_keeps_old_run(fixture, monkeypatch):
    install_plan(fixture)
    before, old = evaluate(fixture)
    old_record = (
        fixture["admin"]
        .execute(
            "select input_manifest,input_hash from public.evaluation_runs where evaluation_id=%s",
            (old,),
        )
        .fetchone()
    )
    monkeypatch.setitem(measurement.POLICY, "q", 0.01)
    after, new = evaluate(fixture)
    assert before.input_hash != after.input_hash and old != new
    assert (
        fixture["admin"]
        .execute(
            "select input_manifest,input_hash from public.evaluation_runs where evaluation_id=%s",
            (old,),
        )
        .fetchone()
        == old_record
    )


def test_resolution_never_confirms_work_or_ai_from_significance(fixture):
    install_plan(fixture)
    with as_actor(fixture, "causent_resolve_worker") as conn:
        result = resolve_prediction(conn, seed.PREDICTION, TODAY, force=True)
    assert result.verdict == "INCONCLUSIVE"
    stored = (
        fixture["admin"]
        .execute(
            "select resolution_tuple from public.predictions where prediction_id=%s",
            (seed.PREDICTION,),
        )
        .fetchone()[0]
    )
    assert stored["interpretation"] == "observational"
    assert stored["measured_lift"] > 30 and stored["ci_low"] > 0
    assert (
        stored["individual_attribution"] is False and stored["ai_attribution"] is False
    )
    assert stored["exposure_start"] == "2026-02-20"


def test_real_member_cannot_retroactively_register_or_forge_foreign_contract(fixture):
    with as_actor(fixture) as conn:
        with pytest.raises(errors.InvalidParameterValue, match="Register before"):
            conn.execute(
                "insert into public.measurement_plans(scope_id,activation_id,metric_id,definition_id,design,estimand,exposure_start,exposure_end,lag_days,window_start,window_end,exposure_source,population,concurrent_changes,concurrent_change_status,decision_threshold,registered_by) "
                "values(%s,%s,%s,%s,'observational_its','immediate_level_change','2026-02-20','2026-02-20',0,'2026-01-01','2026-04-30','deployment','eligible','none','none_known',10,%s)",
                (
                    seed.SCOPE,
                    seed.ACTIVATION,
                    seed.METRIC,
                    fixture["definition"],
                    seed.ACTOR,
                ),
            )


def test_queue_hash_is_the_persisted_evaluation_identity(fixture):
    install_plan(fixture)
    result = process_next_recompute_job(
        fixture["admin"], scope_id=seed.SCOPE, metric_id=seed.METRIC
    )
    assert result.status == "PROCESSED"
    hashes = (
        fixture["admin"]
        .execute(
            "select j.last_input_hash,r.input_hash from private.causal_recompute_jobs j "
            "join public.current_edge_readouts r on r.action_id=%s where j.activation_id=%s",
            (seed.ACTION, seed.ACTIVATION),
        )
        .fetchone()
    )
    assert hashes[0] == hashes[1]
    fixture["admin"].execute(
        "select private.enqueue_current_causal_recompute(%s,%s,'retry',%s)",
        (seed.SCOPE, seed.METRIC, seed.ACTOR),
    )
    fixture["admin"].commit()
    assert (
        process_next_recompute_job(fixture["admin"], scope_id=seed.SCOPE).status
        == "UNCHANGED"
    )


def register_future_plan(f):
    today = f["admin"].execute("select current_date").fetchone()[0]
    with as_actor(f) as conn:
        return conn.execute(
            "insert into public.measurement_plans(scope_id,activation_id,metric_id,definition_id,"
            "design,estimand,exposure_start,exposure_end,lag_days,window_start,window_end,"
            "exposure_source,population,concurrent_changes,concurrent_change_status,decision_threshold,registered_by) "
            "values(%s,%s,%s,%s,'observational_its','immediate_level_change',%s,%s,0,%s,%s,"
            "'deployment schedule','eligible requests','release calendar checked','none_known',10,%s) returning plan_id",
            (
                seed.SCOPE,
                seed.ACTIVATION,
                seed.METRIC,
                f["definition"],
                today + timedelta(days=1),
                today + timedelta(days=1),
                today - timedelta(days=49),
                today + timedelta(days=60),
                seed.ACTOR,
            ),
        ).fetchone()[0]


def test_real_member_registers_once_and_viewer_cannot_record_exposure(fixture):
    f = fixture
    plan = register_future_plan(f)
    with as_actor(f) as conn, pytest.raises(errors.InsufficientPrivilege):
        conn.execute(
            "update public.measurement_plans set decision_threshold=999 where plan_id=%s",
            (plan,),
        )
    f["admin"].execute(
        "update public.memberships set role='viewer' where user_id=%s", (seed.ACTOR,)
    )
    f["admin"].commit()
    with as_actor(f) as conn:
        assert (
            conn.execute(
                "select plan_id from public.measurement_plans where plan_id=%s", (plan,)
            ).fetchone()[0]
            == plan
        )
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.measurement_exposures(plan_id,action_id,scope_id,first_exposure,fully_exposed,source,recorded_by) "
                "values(%s,%s,%s,current_date,current_date,'actual deployment',%s)",
                (plan, seed.ACTION, seed.SCOPE, seed.ACTOR),
            )


def test_waiting_queue_schedules_horizon_and_does_not_busy_loop(fixture):
    f = fixture
    register_future_plan(f)
    result = process_next_recompute_job(f["admin"], scope_id=seed.SCOPE)
    assert result.status == "PROCESSED"
    pending, wake, expected, reason = (
        f["admin"]
        .execute(
            "select j.requested_generation>j.processed_generation, j.next_attempt_at, "
            "((p.window_end+1)::timestamp at time zone 'UTC'),j.last_error_code "
            "from private.causal_recompute_jobs j join public.measurement_plans p using(activation_id) "
            "where j.activation_id=%s",
            (seed.ACTIVATION,),
        )
        .fetchone()
    )
    assert pending and wake == expected and reason == "WAITING_FOR_FIXED_HORIZON"
    assert process_next_recompute_job(f["admin"], scope_id=seed.SCOPE) is None


def test_actual_exposure_mismatch_refuses_before_the_fixed_horizon(fixture):
    install_plan(fixture, actual="2026-02-19")
    assert (
        evaluate(fixture, today=date(2026, 2, 22))[0].refusal
        == "EXPOSURE_DIFFERS_FROM_PLAN"
    )
