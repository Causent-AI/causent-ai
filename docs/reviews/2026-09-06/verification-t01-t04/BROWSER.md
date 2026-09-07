# Local browser acceptance

September 6, 2026, local Next.js app on port 3114, disposable Supabase API 56421/database 56422. The browser used the existing local demo mode; authenticated API and actual database-login coverage are separate gates.

- Data Workshop: uploaded a CSV with 1501 consecutive daily observations (January 1, 2022–February 9, 2026), 1501 new/0 updated. Added `T01 complete history` to Core Metrics; latest value 2500 and last observation date match the CSV.
- Core Metrics drawer: all-history selection includes the complete series and correct current value. Browser inspection exposed a cross-year range label that omitted the start year; the scoped fix now displays `All data · Jan 1, 2022 – Feb 9, 2026`.
- Impact: seeded computed results remain visible; the newly imported metric has a neutral readout. Existing monetary and percentage-point formatting remains intact.
- Actions: seeded decision list and ungrouped actions load. At 390 × 844 the document width is 390; existing navigation scrolls within its own container. No new page overflow.
- Workspace switch: Northstar shows its separate empty decision list and 2 core metrics; returning to Orbit restores 5 core metrics and its decisions.
- Reports: page loads its expected empty state and creation links.
- Browser warning/error log: empty at final inspection. Screenshots were opened and visually inspected. The history screenshot uses the app panel's default 751 × 998 viewport; the mobile screenshot uses 390 × 844.

Evidence: [complete history](browser-history-desktop.png), [mobile Actions](browser-actions-mobile.png).

Not claimed: authenticated browser acceptance, live GitHub ingestion, hosted schema compatibility, partner validation, or production acceptance. Real authenticated CSV/history/graph tests cover tenant scope independently.
