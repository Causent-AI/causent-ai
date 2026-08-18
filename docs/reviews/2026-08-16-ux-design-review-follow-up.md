# Decision Report UX review follow-up

Date: 2026-08-16

Status: local implementation and desktop/mobile full-loop verification are complete. Founder and
partner review remain human-only gates.

This round implements the founder-selected responses to the seven major findings in the 2026-08-16 UX design review. The selections are product-direction decisions, not partner-usability evidence.

## Selected responses

| Finding | Selected response |
|---|---|
| Report identity trust | Create a genuine Northstar project/workspace fixture and resolve it as a real operating scope. |
| Editor reachability | Use a desktop selection bubble; retain a touch-specific formatting surface on mobile. |
| Mobile accessibility | Use a wrapping auto-growing title, one horizontal 44 px formatting row, and 44 px minimum touch targets. |
| Action editing | Make each action one structured editor block with one editable heading, its paragraph, compact metric/primary controls, and details in a sheet. |
| Multiple metrics | Show a compact commitment summary with the primary pair and one action-to-monitoring-metric row per action. |
| Value loop | Put the decision commitment between Core Metrics and the action list. Starting any action activates the exact saved plan; there is no separate acceptance button. |
| Wayfinding | Order the primary tabs `Data -> Reports -> Actions -> Impact`. |

## Locked interaction contracts

### Workspace identity

Northstar is a database-backed project/workspace boundary, not report display metadata. The active workspace is resolved on the server and carried into generation, source receipts, reports, private assets, actions, metrics, recomputation, and dashboard reads. Local service-role access retains explicit scope filters instead of relying on RLS bypass behavior.

### Editing

The report remains exactly two rich document surfaces. Desktop formatting is contextual to selected text. Mobile formatting remains continuously reachable in one horizontally scrolling row. Action titles retain their typed `DraftAction.title` identity even though they are edited in the visible document heading; the rich summary remains a separate portable document.

### Action-start activation

Activation remains an atomic, checked, idempotent database transition. The extra activation-confirmation button is removed. The first deliberate **Start** on any included action submits the exact saved report-wide commitment, activates every included action, and opens the clicked canonical action.

The clicked action is only the navigation target. It does not replace the selected primary action, change the primary outcome, or enter the activation hash. Typing, autosave, blur, navigation, metric selection, adding/removing actions, and opening details do not activate a report. Missing commitment fields, unsaved revisions, conflicts, and unauthorized targets create nothing.

## Boundaries retained

- Active revisions and their canonical decision, prediction, actions, evidence, impact, and private assets remain immutable.
- Successor activation and the series current-pointer move remain atomic.
- Multiple metrics remain audited supporting measurements; only the chosen primary outcome and primary action form the causal primary pair.
- Cross-workspace, forged, viewer, and stale identities fail closed.
- This implementation does not mark the missing partner-session gate passed and is not a production deployment.

## Validation record

- Clean local Supabase reset: **PASS**.
- Supabase schema lint: **COMPLETE** with four pre-existing warnings and no new error-level finding
  attributed to this round.
- Full TypeScript check and full application lint: **PASS**.
- Credentialed TypeScript integration suite: **40/40 passed**.
- Python engine, bridge, isolation, recompute, function, and concurrency suite: **1,219 passed**.
- Next.js 16 webpack production build and the request-bound dashboard build contract: **PASS**.
- Desktop browser full-loop acceptance across the two real local workspaces: **PASS**.
- Mobile browser acceptance at 390 x 844: **PASS**. The page has no horizontal overflow; the report
  title wraps; the two canvases retain one horizontally scrolling 44 px formatting row; all visible
  shell, formatting, and details-sheet controls meet the 44 px target.
- Cross-workspace and navigation browser acceptance: **PASS**. Explicit workspace switching clears a
  mounted draft, inaccessible report links fail with a generic message, and a support action opens its
  exact canonical Actions row without changing the primary action or outcome.
- Browser console review on the final desktop and mobile paths: **PASS** with no warning or error.

No commit, push, PR, production migration, or deployment was performed for this round. The founder's
hands-on review and the initially unassisted partner sessions remain human-only gates; local tests and
browser evidence do not satisfy them.
