# Causent UI comparisons

Prepared September 18; final D revision September 21, 2026.

- **A — Original:** actual local Causent app at `localhost:3115`, presented in a labeled preview frame. Uses the saved synthetic review workspace and retains all engineering changes on `codex/p2-and-ux-review` at `5248434`. This is the existing app interface, not a verified snapshot of the current hosted production deployment.
- **B — Clean:** independent snapshot of `../ux-proposal/index.html` as of September 18, including the September 15 color refinements. Only its title, proposal label, and comparison link differ. Local assets are copied with it. Illustrative content, no connected services, edits last until reload.
- **C — Combined:** built September 20 from the user’s detailed comments. See [C notes](c/README.md) for the interaction scope and verification. A and B remain unchanged.

- **D — Connected:** independent copy of C plus a timeline decision graph, portfolio grouping, and Data → AI. Includes local configuration forms and sample usage; no runner or AI service is connected. See [D notes](d/README.md). Earlier designs remain available; C has only build/lint cleanup for PR packaging.

Open http://localhost:3135/ui-proposals/ for the comparison, or append `a/`, `b/`, `c/`, or `d/`. Use localhost consistently so A and its review sign-in share the same local session. A and B contain different sample reports; compare their layout and interaction patterns.

## Restart

From the repository root, start the original app with `npm run dev:review`. This restores the existing isolated review configuration and preserves the saved database. If needed, open http://localhost:3125/ and select **Sign in to local review**, then return to A.

In another terminal, serve the proposals with:

```sh
python3 -m http.server 3135 --bind 127.0.0.1 --directory docs/reviews/2026-09-07
```

## Verification

Browser checks passed for the comparison page, A's report library and full report editor, and B's Data/Reports switching and Ask drawer. Both preview tabs reported no console errors during the checked flows. The original stalled development and static preview servers were restarted. The app, backend, schema, and workers were not edited for this comparison setup. No commit, push, or deployment was performed.
