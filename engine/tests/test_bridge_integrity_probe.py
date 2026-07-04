"""Adversarial integrity probes for the persistence bridge (feat/persistence-bridge).

Each probe SEEDS its own namespaced tenant as the (bypassrls) postgres superuser, runs
the bridge AS THE USER over a fresh RLS-scoped `authenticated` connection (exactly the
e2e harness contract), and then asserts a concrete DATA-INTEGRITY / RLS defect with a
proof read back from the DB. These are adversarial: they PASS when the defect is present.

Findings proved here:
  A) MATERIALIZATION DRIFT — an ACTION->METRIC edge whose belief_score DISAGREES with the
     latest authoritative ITS evidence row it points at. BH-FDR (batch_readout) silently
     demotes a would-be 1.0/POSITIVE edge to 0.5/INCONCLUSIVE, but the demotion is written
     with belief_reason = NULL and NO trace on the evidence row, so belief is NOT
     reproducible from the persisted authoritative evidence (violates bridge.py's stated
     invariant + test_bridge_e2e Gate 3).
  B) CROSS-SCOPE MATERIALIZATION — persist_metric_readouts trusts its scope_id argument
     and never checks the metric actually lives in that scope. A METRIC node is written
     into workspace X carrying semantic_ref of a metric that lives in workspace Y. RLS
     does NOT catch it (the user is member of both), so the graph is silently corrupted
     across the workspace isolation boundary.
  D) CLUSTER DOUBLE-MATERIALIZATION — clusters are keyed on their (data-dependent) window.
     When a later action extends a collision group's window, a re-run mints a NEW cluster
     (new id -> new CLUSTER node + new CLUSTER->METRIC edge) and NEVER retires the old one,
     so one collision group ends up represented by two live cluster edges.
"""

from __future__ import annotations

import contextlib
import json
import uuid
from bisect import bisect_left
from datetime import date, timedelta

import numpy as np
import psycopg

from causal.belief_direction import belief_direction
from causal.its_readout import its_readout
from causal.placebo_in_time import placebo_in_time
from causal.types import Series
from persistence.bridge import persist_metric_readouts

DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
_START = date(2026, 1, 1)


def _su() -> psycopg.Connection:
    c = psycopg.connect(DSN)
    c.autocommit = True
    return c


@contextlib.contextmanager
def _as_user(user_id: uuid.UUID, autocommit: bool = True):
    conn = psycopg.connect(DSN)
    conn.autocommit = autocommit
    try:
        with conn.cursor() as cur:
            cur.execute("set role authenticated")
            claims = json.dumps({"sub": str(user_id), "role": "authenticated"})
            cur.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
        yield conn
    finally:
        conn.close()


def _run_bridge_as_user(user_id: uuid.UUID, scope_id: uuid.UUID, metric_id: uuid.UUID) -> None:
    conn = psycopg.connect(DSN)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute("set role authenticated")
            claims = json.dumps({"sub": str(user_id), "role": "authenticated"})
            cur.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
        persist_metric_readouts(conn, scope_id, metric_id)
    finally:
        conn.close()


def _seed_scope_spine(cur, org, proj, ws, user, role="owner"):
    cur.execute("insert into auth.users (id) values (%s) on conflict do nothing", (user,))
    cur.execute("insert into public.orgs (org_id, name) values (%s,'PROBE_org')", (org,))
    cur.execute("insert into public.projects (project_id, org_id, name) values (%s,%s,'PROBE_proj')", (proj, org))
    cur.execute("insert into public.workspaces (workspace_id, project_id, name) values (%s,%s,'PROBE_ws')", (ws, proj))
    cur.execute("insert into public.memberships (user_id, org_id, role) values (%s,%s,%s)", (user, org, role))


# ============================================================================
# FINDING A — belief edge vs latest authoritative ITS evidence row DRIFT (BH-FDR).
# ============================================================================
def test_probe_a_fdr_edge_belief_drifts_from_authoritative_evidence():
    ORG = uuid.uuid4(); PROJ = uuid.uuid4(); WS = uuid.uuid4(); USER = uuid.uuid4()
    METRIC = uuid.uuid4()
    S = uuid.uuid4()                       # the marginally-significant action
    INCON = [uuid.uuid4() for _ in range(4)]

    # A 160-day series, base 100 + N(0,4) noise, with a MODEST +2 step at index 70.
    # (Tuned offline: S individually reads OK / CI-excludes-0 / DW ok / placebo clean
    #  -> belief 1.0 POSITIVE, p ~ 0.05; but 4 co-metric OK-inconclusive actions inflate
    #  the BH family so batch_readout demotes S to 0.5 / INCONCLUSIVE.)
    n, step_at = 160, 70
    rng = np.random.default_rng(7)
    vals = 100.0 + rng.normal(0.0, 4.0, n)
    vals[step_at:] += 2.0
    dates = [_START + timedelta(days=i) for i in range(n)]
    incon_idx = [100, 105, 110, 115]

    su = _su()
    try:
        with su.cursor() as cur:
            _seed_scope_spine(cur, ORG, PROJ, WS, USER)
            cur.execute("insert into public.metrics (metric_id, scope_id, name, source) values (%s,%s,'PROBE_A','csv')", (METRIC, WS))
            cur.executemany(
                "insert into public.metric_observations (metric_id, obs_date, value) values (%s,%s,%s)",
                [(METRIC, d, float(v)) for d, v in zip(dates, vals)],
            )
            cur.execute(
                "insert into public.actions (action_id, scope_id, source, external_ref, effective_date) values (%s,%s,'manual','S',%s)",
                (S, WS, dates[step_at]),
            )
            for a, idx in zip(INCON, incon_idx):
                cur.execute(
                    "insert into public.actions (action_id, scope_id, source, external_ref, effective_date) values (%s,%s,'manual','I',%s)",
                    (a, WS, dates[idx]),
                )

        _run_bridge_as_user(USER, WS, METRIC)

        with su.cursor() as cur:
            # The persisted ACTION->METRIC edge for S.
            cur.execute(
                "select ce.belief_score, ce.direction, ce.belief_reason, ce.authoritative_method "
                "from public.causal_edges ce join public.nodes n on n.node_id = ce.source_node_id "
                "where n.type='ACTION' and n.semantic_ref=%s and ce.scope_id=%s",
                (S, WS),
            )
            belief_score, direction, belief_reason, method = cur.fetchone()

            # Recompute the AUTHORITATIVE ITS readout from the exact DB series the bridge
            # loaded (mirrors test_bridge_e2e Gate 3's own oracle).
            cur.execute(
                "select obs_date, value from public.metric_observations where metric_id=%s order by obs_date",
                (METRIC,),
            )
            rows = cur.fetchall()
            ords = [d.toordinal() for d, _ in rows]
            vv = np.array([float(v) for _, v in rows], dtype=np.float64)
            split = bisect_left(ords, dates[step_at].toordinal())
            view = Series(np.array(ords, dtype=np.int64), vv, split)
            its = its_readout(view)
            placebo = placebo_in_time(view, its)
            authoritative = belief_direction(its, placebo)

            # The latest ITS evidence row this edge points at.
            cur.execute(
                "select ce.edge_id from public.causal_edges ce join public.nodes n on n.node_id=ce.source_node_id "
                "where n.type='ACTION' and n.semantic_ref=%s and ce.scope_id=%s", (S, WS))
            edge_id = cur.fetchone()[0]
            cur.execute(
                "select lift, ci_low, ci_high, p_value, placebo_fired from public.evidence_objects "
                "where edge_id=%s and methodology='ITS' order by created_at desc, evidence_id desc limit 1",
                (edge_id,))
            ev_lift, ev_ci_low, ev_ci_high, ev_p, ev_placebo_fired = cur.fetchone()

        print("\n[FINDING A] BH-FDR materialization drift")
        print(f"  authoritative ITS readout  : belief={authoritative.belief_score} dir={authoritative.direction} reason={authoritative.reason}")
        print(f"  persisted edge             : belief={belief_score} dir={direction} reason={belief_reason} method={method}")
        print(f"  latest ITS evidence row    : lift={float(ev_lift):.4f} ci=({float(ev_ci_low):.4f},{float(ev_ci_high):.4f}) p={float(ev_p):.4f} placebo_fired={ev_placebo_fired}")

        # The authoritative readout the evidence row materializes supports a CONFIDENT edge.
        assert authoritative.belief_score == 1.0 and authoritative.direction == "POSITIVE"
        # The evidence row agrees: significant positive step (CI excludes 0), placebo clean.
        assert float(ev_ci_low) > 0.0 and float(ev_p) < 0.05 and not ev_placebo_fired
        # ...but the PERSISTED edge disagrees, with NO belief_reason to explain the demotion.
        assert belief_score is not None and abs(float(belief_score) - 0.5) < 1e-9
        assert direction == "INCONCLUSIVE"
        assert belief_reason is None, "demotion left a reason -> would be auditable"
        # DRIFT: the edge belief != belief_direction() of its authoritative ITS evidence row.
        assert float(belief_score) != authoritative.belief_score
        print("  => DRIFT CONFIRMED: edge belief 0.5/INCONCLUSIVE (reason NULL) contradicts its "
              "own authoritative ITS evidence (1.0/POSITIVE, significant); belief is not "
              "reproducible from the persisted evidence.")
    finally:
        with su.cursor() as cur:
            cur.execute("delete from public.orgs where org_id=%s", (ORG,))
            cur.execute("delete from auth.users where id=%s", (USER,))
        su.close()


# ============================================================================
# FINDING B — cross-scope materialization (bridge trusts scope_id vs the metric).
# ============================================================================
def test_probe_b_cross_scope_materialization():
    ORG = uuid.uuid4(); PROJ = uuid.uuid4(); USER = uuid.uuid4()
    WS_X = uuid.uuid4()   # the scope we PASS
    WS_Y = uuid.uuid4()   # the scope the metric actually LIVES in
    METRIC_Y = uuid.uuid4()

    n = 120
    rng = np.random.default_rng(3)
    vals = 100.0 + rng.normal(0.0, 2.0, n)
    dates = [_START + timedelta(days=i) for i in range(n)]

    su = _su()
    try:
        with su.cursor() as cur:
            # One org, one project, two workspaces. Org-level OWNER => member of BOTH.
            cur.execute("insert into auth.users (id) values (%s) on conflict do nothing", (USER,))
            cur.execute("insert into public.orgs (org_id, name) values (%s,'PROBE_B_org')", (ORG,))
            cur.execute("insert into public.projects (project_id, org_id, name) values (%s,%s,'p')", (PROJ, ORG))
            cur.execute("insert into public.workspaces (workspace_id, project_id, name) values (%s,%s,'WS_X')", (WS_X, PROJ))
            cur.execute("insert into public.workspaces (workspace_id, project_id, name) values (%s,%s,'WS_Y')", (WS_Y, PROJ))
            cur.execute("insert into public.memberships (user_id, org_id, role) values (%s,%s,'owner')", (USER, ORG))
            # The metric lives in WS_Y.
            cur.execute("insert into public.metrics (metric_id, scope_id, name, source) values (%s,%s,'M_Y','csv')", (METRIC_Y, WS_Y))
            cur.executemany(
                "insert into public.metric_observations (metric_id, obs_date, value) values (%s,%s,%s)",
                [(METRIC_Y, d, float(v)) for d, v in zip(dates, vals)],
            )

        # Call the bridge with a MISMATCHED (scope=WS_X, metric=M_Y in WS_Y). No RLS error.
        _run_bridge_as_user(USER, WS_X, METRIC_Y)

        with su.cursor() as cur:
            cur.execute(
                "select n.scope_id, n.semantic_ref from public.nodes n "
                "where n.type='METRIC' and n.semantic_ref=%s", (METRIC_Y,))
            node_scope, node_ref = cur.fetchone()
            cur.execute("select scope_id from public.metrics where metric_id=%s", (METRIC_Y,))
            metric_scope = cur.fetchone()[0]

        print("\n[FINDING B] cross-scope materialization")
        print(f"  METRIC node written into scope : {node_scope}  (semantic_ref={node_ref})")
        print(f"  but that metric actually lives in scope : {metric_scope}")
        assert node_scope == WS_X, "node landed in the passed scope X..."
        assert metric_scope == WS_Y, "...while the metric it references belongs to scope Y"
        assert node_scope != metric_scope, (
            "bridge persisted a child graph row whose scope_id differs from its metric's scope"
        )
        print("  => CROSS-SCOPE CONFIRMED: a METRIC node in workspace X references a metric "
              "owned by workspace Y; RLS allowed it (org member of both). The bridge never "
              "validates metric.scope_id == scope_id.")
    finally:
        with su.cursor() as cur:
            cur.execute("delete from public.orgs where org_id=%s", (ORG,))
            cur.execute("delete from auth.users where id=%s", (USER,))
        su.close()


# ============================================================================
# FINDING D — cluster double-materialization when a later action grows the window.
# ============================================================================
def test_probe_d_cluster_window_double_materialization():
    ORG = uuid.uuid4(); PROJ = uuid.uuid4(); WS = uuid.uuid4(); USER = uuid.uuid4()
    METRIC = uuid.uuid4()
    B = uuid.uuid4(); C = uuid.uuid4(); D = uuid.uuid4()

    n = 120
    rng = np.random.default_rng(5)
    vals = 100.0 + rng.normal(0.0, 2.0, n)
    dates = [_START + timedelta(days=i) for i in range(n)]
    # B@30, C@43 (13d after B -> collide), D@53 (10d after C -> extends the same group).
    iB, iC, iD = 30, 43, 53

    su = _su()
    try:
        with su.cursor() as cur:
            _seed_scope_spine(cur, ORG, PROJ, WS, USER)
            cur.execute("insert into public.metrics (metric_id, scope_id, name, source) values (%s,%s,'PROBE_D','csv')", (METRIC, WS))
            cur.executemany(
                "insert into public.metric_observations (metric_id, obs_date, value) values (%s,%s,%s)",
                [(METRIC, d, float(v)) for d, v in zip(dates, vals)],
            )
            # RUN-1 population: only B and C (they collide into one cluster).
            cur.executemany(
                "insert into public.actions (action_id, scope_id, source, external_ref, effective_date) values (%s,%s,'manual',%s,%s)",
                [(B, WS, "B", dates[iB]), (C, WS, "C", dates[iC])],
            )

        _run_bridge_as_user(USER, WS, METRIC)  # RUN 1

        def cluster_counts():
            with su.cursor() as cur:
                cur.execute("select count(*) from public.clusters where scope_id=%s and metric_id=%s", (WS, METRIC))
                clusters = cur.fetchone()[0]
                cur.execute("select count(*) from public.nodes where scope_id=%s and type='CLUSTER'", (WS,))
                cnodes = cur.fetchone()[0]
                cur.execute(
                    "select count(*) from public.causal_edges ce join public.nodes n on n.node_id=ce.source_node_id "
                    "where ce.scope_id=%s and n.type='CLUSTER'", (WS,))
                cedges = cur.fetchone()[0]
                return clusters, cnodes, cedges

        after_run1 = cluster_counts()

        # Now a LATER action D ships within 14d of C, extending the collision group's window.
        with su.cursor() as cur:
            cur.execute(
                "insert into public.actions (action_id, scope_id, source, external_ref, effective_date) values (%s,%s,'manual','D',%s)",
                (D, WS, dates[iD]),
            )

        _run_bridge_as_user(USER, WS, METRIC)  # RUN 2 (same metric, one new action)

        after_run2 = cluster_counts()

        print("\n[FINDING D] cluster window double-materialization")
        print(f"  run1 (B,C)      -> clusters={after_run1[0]} cluster_nodes={after_run1[1]} cluster_edges={after_run1[2]}")
        print(f"  run2 (B,C,D)    -> clusters={after_run2[0]} cluster_nodes={after_run2[1]} cluster_edges={after_run2[2]}")
        assert after_run1 == (1, 1, 1), f"run1 should make exactly one cluster overlay, got {after_run1}"
        # The collision group is STILL a single group (B,C,D) — but the window grew, so a
        # brand-new cluster id/node/edge is minted and the old one is never retired.
        assert after_run2[0] == 2 and after_run2[1] == 2 and after_run2[2] == 2, (
            f"expected stale+new cluster double-materialization, got {after_run2}"
        )
        # Prove the old cluster is now ORPHANED (no action points at it) yet its edge lives on.
        with su.cursor() as cur:
            cur.execute(
                "select c.cluster_id from public.clusters c where c.scope_id=%s and c.metric_id=%s "
                "and not exists (select 1 from public.actions a where a.cluster_id=c.cluster_id)",
                (WS, METRIC))
            orphaned = cur.fetchall()
            cur.execute("select cluster_id from public.actions where action_id in (%s,%s,%s)", (B, C, D))
            member_cluster_ids = {r[0] for r in cur.fetchall()}
        print(f"  orphaned cluster rows (no member points at them): {len(orphaned)}")
        print(f"  B,C,D all now point at the NEW cluster id(s): {member_cluster_ids}")
        assert len(orphaned) == 1, "the run-1 cluster is left orphaned but its node+edge persist"
        print("  => DOUBLE-MATERIALIZATION CONFIRMED: one collision group is represented by two "
              "live CLUSTER->METRIC edges after the window grew; the stale overlay is never retired.")
    finally:
        with su.cursor() as cur:
            cur.execute("delete from public.orgs where org_id=%s", (ORG,))
            cur.execute("delete from auth.users where id=%s", (USER,))
        su.close()
