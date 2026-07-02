# TODOS

Deferred work with enough context to pick up cold. Priority: P1 (blocks ship) →
P3 (nice to have). Effort shown as human → with Claude Code.

## P3 — Full-history GitHub backfill worker
- **What:** Background worker to backfill a repo's entire PR/issue history beyond
  the v1 capped window (default ~90 days / N PRs).
- **Why:** v1 caps backfill to fit inside one Vercel request. A design partner who
  wants their full multi-year history rendered on the causal graph will hit that
  ceiling. The capped window is a documented v1 limitation, not a permanent one.
- **Current state:** v1 backfills only the recent window inline on connect (decision
  A2, CEO review 2026-07-02). No worker infra exists.
- **Where to start:** Supabase scheduled function / cron or a queue worker that pages
  GitHub REST/GraphQL with rate-limit backoff (respect `Retry-After`), writes a
  resumable cursor, and upserts ACTION nodes idempotently (dedup on external_ref).
- **Effort:** L (human) → M (CC). **Priority:** P3.
- **Depends on:** a background-job mechanism the PRD deliberately deferred; land the
  v1 capped-window path and a real partner request first.
- **Source:** /plan-ceo-review 2026-07-02, finding A2 + CEO plan
  `~/.gstack/projects/adam-causent-causent-ai/ceo-plans/2026-07-02-did-it-ship-did-it-work.md`
