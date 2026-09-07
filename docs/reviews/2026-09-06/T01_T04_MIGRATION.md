# T01–T04 schema and operations contract

This is a reviewed release plan, not authorization to migrate or deploy. Local execution used only the separate `causent-t01-t04` stack (API 56421, database 56422). Shared and production state were not modified.

## Dependencies and behavior

Apply `supabase/migrations/20260907035048_t01_t04_integrity.sql` after the existing migration chain. It introduces immutable `evaluation_runs`, evidence snapshots, `current_edge_readouts`, GitHub aliases, and two service-only ingestion/reconciliation functions. No new SECURITY DEFINER function is introduced. Trigger authority uses the actual database login (`session_user`), independently of caller-supplied claims. Trusted application workers still assume `authenticated` with the initiating user's claims and pass RLS.

The trusted logins are `causent_recompute_worker` and `causent_resolve_worker`; database owners `postgres` and `supabase_admin` retain maintenance authority. The API service role cannot insert evaluations. A service role is still privileged elsewhere in the existing schema; this work does not redefine all administrative capabilities.

Old workers cannot write computed results after this migration because they do not supply evaluation identity. The new application requires the new view. The migration preserves old evidence and labels it `legacy_unverified`; it does not invent verified input history. New verified computation is required before a legacy edge regains a computed readout.

## Coordinated release sequence

1. Owner reviews the draft PR, acceptance evidence, schema and rollback plan. Preserve a database backup and record the pre-release schema/application/worker versions. Rehearse restoration in an isolated environment.
2. Pause ingestion and recompute/resolution triggers while coordinating the release. Confirm no old worker execution remains in flight. The migration takes relation locks while adding columns, triggers and indexes; local tests do not establish production lock duration.
3. Apply the additive migration to the intended environment, then deploy matching recompute and resolve workers and the application candidate. Check actual login identity, grants/RLS, migration version and candidate source commit independently. Do not activate mismatched versions.
4. Inventory legacy GitHub aliases with `IDENTITY_AUDIT.sql`. Use the stored source URL and GitHub's repository API to resolve a stable numeric repository ID. Follow provider redirects for renames/transfers and confirm the PR/issue number and kind. Missing URLs, inaccessible repositories and conflicting histories stay unresolved.
5. Review the collision report before invoking `reconcile_github_identity_v1`. Reconciliation preserves the action UUID and therefore its graph/prediction references. It retains the old reference as an alias and changes only canonical identity. A collision raises an error; it never merges or deletes histories. An unresolved alias blocks an incoming same-kind/same-number import conservatively, even if its repository is different, until ambiguity is resolved.
6. Recompute eligible existing results with the matching worker and verified actor scope. The existing unchanged-input skip hash remains unchanged (T09 deferred); a generation request alone may skip an old result. Use an explicitly reviewed maintenance recomputation or a separately approved cache invalidation plan, not a claimed automatic backfill.
7. Resume writers after authenticated acceptance: full history/current date; manual versus computed behavior; same-number repository imports; repeated and overlapping imports with exact counts. Observe failures and queue receipts. Promote/enable exposure only through the separately authorized release process.

## Reconciliation example

After independently verifying the provider repository ID and reviewing the audit output, call the service-only function using bound parameters:

```sql
select public.reconcile_github_identity_v1(
  p_scope_id := :scope_id,
  p_action_id := :action_id,
  p_canonical_ref := 'github:repo:id:123:pr:42',
  p_source_url := 'https://github.com/acme/app/pull/42'
);
```

The example IDs are illustrative. Do not substitute a repository name for its provider ID. The function validates stored URL equality, original kind/number/source, tenant scope and collisions; provider verification is an operator responsibility. The migration cannot recover an action already discarded by the old duplicate key: reconcile the surviving history, then review/replay the missing repository separately.

## Rollback and retention

Prefer a forward fix with writers paused. The schema is additive but application/worker compatibility is not bidirectional. Rolling workers back alone causes write failures; rolling the application back reintroduces incomplete/unverified display behavior. Do not disable guards or grant members computed authority as a rollback shortcut.

If restoration is necessary, use the pre-release backup and a coordinated application/worker rollback under an approved recovery plan. Preserve new evaluation/evidence/alias data separately before restoring. No destructive down migration is supplied: dropping run IDs would erase the integrity boundary and audit history. Parent workspace/metric cleanup retains existing cascade semantics; immutable means no ordinary update/delete of evaluation records, not immunity from an authorized parent deletion or database administration.

## Local collision report

| Case | Verified outcome |
|---|---|
| PR 42 in repository 123 and PR 42 in repository 456 | Distinct canonical identities and distinct action UUIDs |
| Repository renamed or transferred with unchanged provider ID | Same canonical identity; replay counted as duplicate |
| Legacy `github:pr:42` with a stored source URL | Migration retains UUID and adds `needs_provider_verification` alias |
| Incoming identity matches unresolved legacy kind/number | Batch fails visibly before any action insert |
| Verified legacy mapping with no canonical collision | UUID retained, old alias retained and marked verified |
| Verified mapping collides with an existing canonical action | SQLSTATE 23505; neither history merged or deleted |

This reports disposable fixtures, not a production inventory. The [role/concurrency test](../../../engine/tests/test_t01_t04_integrity.py) and [legacy upgrade receipt](verification-t01-t04/legacy-upgrade-check.log) provide the executable evidence.
