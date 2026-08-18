# Multi-metric activation production rollout

This rollout keeps v1/v2 activation available until the final contract
migration. Rehearse it on a production-sized clone and keep the v3 application
disabled until every migration has completed.

## 1. Build parent identity indexes before `db push`

Run these statements as the database owner, outside an explicit transaction.
They avoid write-blocking index builds on populated parent tables. The expand
migration contains reset-compatible `CREATE UNIQUE INDEX IF NOT EXISTS`
fallbacks, so a clean local database does not need this manual step.

```sql
create unique index concurrently if not exists
  decision_report_activations_activation_id_scope_id_key
  on public.decision_report_activations(activation_id, scope_id);

create unique index concurrently if not exists
  metrics_metric_id_scope_id_key
  on public.metrics(metric_id, scope_id);

create unique index concurrently if not exists
  actions_action_id_scope_id_key
  on public.actions(action_id, scope_id);
```

Confirm all three rows have `indisvalid` and `indisready` set to true in
`pg_index` before applying migrations.

## 2. Apply migrations and finish any gated backfill

The backfill migration processes at most 100 activations. If validation raises
`MULTI_METRIC_BACKFILL_REQUIRED`, the expand and backfill migrations are
already committed but v3 is still unavailable. Run bounded owner-only calls in
separate transactions:

```sql
select *
from private.backfill_decision_report_multi_metric_v1(500, null);
```

For large histories, pass the returned `last_activation_id` into the next call
to avoid rescanning the completed prefix. When a pass reaches the end with
`has_more = true`, restart once with a null cursor to collect rows skipped by a
concurrent lock. Stop only when `has_more = false`, then rerun `db push`.

The validate migration attaches the prebuilt indexes as unique constraints,
installs foreign keys as `NOT VALID`, and validates historical rows separately.
The contract migration swaps only already-validated checks, removes the
rollout-only backfill function, and then exposes `activate_decision_report_v3`.

## 3. Release order and rollback

Deploy database contract first, then enable the v3 application. On application
rollback, return callers to v1/v2; do not remove the append-only activation
relations or their validated constraints.
