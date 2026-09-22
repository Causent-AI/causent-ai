# SEC01 · Data infrastructure and frontend

Scope: delta from `01535f2`, plus existing auth, report/source ingestion, private-image Storage and dependency boundaries. This is a source/local integration review for the GA4 draft PR. Hosted Supabase/Vercel configuration and real Google acceptance remain unchecked release gates.

## Findings and remediation

| Finding | Severity / evidence | Resolution |
|---|---|---|
| Vulnerable application dependencies | Initial npm audit: 35 affected package entries, including 1 critical, 7 high and 27 moderate. Counts include transitive duplicates, not 35 independent exploits. | Next/ESLint 16.3.5, Tiptap 3.31.3, Sharp 0.35.4, Undici 8.10.2, PostCSS 8.5.28 and affected transitive utilities updated. Final audit: zero reported vulnerabilities. C/D editor bundles rebuilt. A separate pip-audit of the ten installed Python runtime/test packages also reported zero known vulnerabilities; this does not pin future dependency resolution. |
| Editor attribute prototype pollution | Tiptap's vulnerable merge path could inherit attacker-controlled attributes. | Patched dependency plus an executable-attribute regression test; C/D paragraph editing and title synchronization checked in the browser. |
| Application lacked explicit frame/object/base protections | No global application policy in `next.config.ts`. | Added frame denial, object/base restrictions, nosniff, referrer and device-permission headers. GA4 callbacks explicitly retain `no-referrer`/`no-store`. This is a limited CSP, not a complete script-source XSS policy. |
| Connector race and provenance boundaries | New-code review: null/expired lease, revoked membership, revised observations, and removed provider rows needed explicit behavior. | Non-null leases/generations, locked admin checks, atomic complete batches, source-write guards, immutable receipts and immediate readout withholding. Real PostgreSQL adversarial tests pass. |

Primary advisories: [Next image processing](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), [Tiptap attributes](https://github.com/advisories/GHSA-cp6q-959q-f8rh), [Tiptap Markdown parsing](https://github.com/advisories/GHSA-j95f-988m-3j2f). Version findings establish exposure to affected packages; this review found no evidence of exploitation and does not establish that every advisory's exploit prerequisites were present. Fixes are not production-deployed by this PR.

## Verified boundaries

- Database: owner/admin/member/viewer/outsider and two-tenant tests; private credentials denied to ordinary clients and the worker's direct SQL role; provider metric/observation mutation denied. The worker is NOLOGIN/NOINHERIT/NOBYPASSRLS with no direct table grants. A real local PostgREST signed worker JWT could invoke its RPC and received 403 on direct observations. Its only additional executable private routine is an existing trigger function, which cannot be called directly.
- Queue/OAuth: single-use actor-bound state, fixed redirect, browser state cookie, serialized refresh lease, simultaneous claims, stale-generation rejection, membership removal and archival, another admin's disconnect, lost-response replay and multi-metric rollback. Local HTTP checks cover foreign Origin, oversized JSON, callback mismatch/denial and cron authentication.
- Analysis: revised receipts immediately suppress old results pending recomputation. Provider quality, authorization, generation and freshness are checked both in the SQL readout and Python loader. Models retain their previous formulas and thresholds.
- Public bundles: checked the production static output for GA4 secret/key names and the Supabase service-role variable; none appeared. This bounded check is not a general secret-scanner certification.
- Sources/frontend: existing URL tests cover DNS/IP pinning, private-address/redirect denial, byte bounds and timeouts. PDF/image tests cover type/size/parsing limits and scoped private delivery. Imported labels render through React text nodes. New provider requests use fixed Google hosts and disallow redirects. No new HTML injection path is introduced.
- Storage/local configuration: `decision-report-assets` is private, limited to PNG/JPEG and 5 MiB. Final local schema lint passes. Security advisors at INFO level returned seven intentional RLS-without-policy notices on default-deny server tables, including the two private GA4 tables; zero warnings/errors. Private schema is not exposed by local PostgREST.

## Release gates and residual limits

Real Google property acceptance, hosted auth/Storage/CORS configuration, live API exposure/advisors, exact deployed headers and preview/production secret separation still require staging verification. This worktree has no linked hosted Supabase target. A passing local database is not evidence for those settings. Complete the [operator runbook](../../integrations/google-analytics.md) before enabling customer connections.

The app holds a scoped worker token plus a credential-encryption key: compromise of the application runtime can expose connected Google grants. Keep both server-only, use short operational token lifetimes with renewal, separate environments, and rehearse revocation/key rotation. A strict nonce-based script CSP remains a separate hardening step; the limited policy here does not claim to stop arbitrary inline scripts.

[Engineering review and reproducible checks](GA4_ENGINEERING_REVIEW.md) records test outcomes, toolchain limits and submission state.
