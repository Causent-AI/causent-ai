# Decision Report structured rich editor — 2026-08-16

## Direction

Founder review found that the Review #2 auto-growing native narrative fields still felt like basic
form inputs. This run deliberately expands that presentation boundary into a real embedded document
editor while preserving Causent's report-native domain model. This does not declare the remaining
founder or partner review gates complete.

## Delivered contract

- Tiptap 3/ProseMirror supplies the client editor runtime; the onboarding challenge form lazy-loads
  the editor only after a generated or saved report is selected.
- One sticky document toolbar targets the focused claim and supports paragraph/heading styles, bold,
  italic, underline, strike, bullet/numbered lists, block quotes, HTTP(S) links, clear formatting,
  undo, and redo.
- Rich editing covers Background, Problem, Decision, up to three supporting-evidence claims, the
  implementation summary, and action descriptions. Report title, action identity, owners, estimates,
  priority, tags, skills, metrics, assets, and activation remain typed controls.
- The application persists optional `presentation.version = 1` JSON keyed by stable claim ID.
  `Claim.text` stays canonical; every portable document must flatten exactly to that value.
- Formatting-only edits preserve sourced provenance. Text changes remain `user_confirmed`, clear
  `sourceChunkIds`, and continue through the existing validated `ReportEditCommandV1` path.
- Legacy reports synthesize plain documents without a data migration. Active reports remain read-only;
  successors, autosave serialization, exact retries, stale conflicts, asset isolation, activation,
  and current-report selection are unchanged.

## Safety and bounds

The portable schema permits only document, paragraph, h2/h3, bullet/ordered list, list item, block
quote, hard break, and text nodes; bold, italic, strike, underline, and link marks; and absolute
HTTP(S) links. It caps each document at 256 nodes, depth 8, 20,000 characters, and 32 links, and caps
the entire presentation at 96 KiB. Tiptap clipboard parsing plus a pure adapter removes Docs/Word
library attributes, unsupported structure, unsafe links, and raw HTML before the report command runs.

## Explicit non-goals

This is a polished single-user structured editor, not Google Docs collaboration. Presence, comments,
suggestions, collaborative CRDT/OT sync, offline editing, pagination, Markdown source mode, arbitrary
embeds, and user-defined report templates remain out of scope pending founder/partner review.

## Verification

- TypeScript and full application ESLint: **PASS**.
- Complete library suite: **576 total; 520 passed, 56 intentional environment/live-model skips,
  zero failed**. Focused rich-editor schema, command, adapter, provenance, size, and adversarial-link
  cases pass within that run.
- Next.js `16.2.11` webpack production build on the supported Node 22 runtime: **PASS**; all six static
  pages generated and every dashboard/report route compiled.
- Browser acceptance: **PASS on desktop** for toolbar targeting, formatting, undo, sanitized rich
  paste, safe-link normalization, status/provenance behavior, reload fallback, and an empty fresh
  warning/error log. A true 390 px hands-on pass remains part of the founder review.
- Read-only production dependency audit still reports the repository's pre-existing Next/PostCSS,
  Nano ID, and Undici advisories; the new Tiptap dependency tree is not on any reported advisory path.
- No commit, push, PR mutation, database migration, or deployment was performed.
