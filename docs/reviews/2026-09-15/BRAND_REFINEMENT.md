# Causent document proposal: branding and shared onboarding

The September 15 revision restores the existing Causent identity and familiar navigation in the interactive proposal. The application, APIs, database migrations, and workers retain all T11–T14 changes. This is a prototype revision, with prepared examples and no connected services; it does not implement the proposed app redesign.

## Changes

- Restored the actual dot-grid mark and outlined wordmark. The local SVG uses the same original shapes and positions as `components/shell/Logo.tsx`, drawn from `public/logo.svg`.
- Replaced the sage theme with **Causent teal `#00AAA7`**, the logo color closest to green. Blue `#4285F4` and gold `#F1C232` provide supporting accents. White surfaces and the logo's neutral text color retain legibility. Dark text on primary teal buttons has a 5.78:1 contrast ratio, and 4.58:1 on hover.
- Restored rounded pill navigation for Data, Reports, Actions, and Impact.
- Refined the report outline, text selection, and selected tab highlights to pale blue-green `#D8F2EF`. The Ask button uses logo yellow `#F1C232`, with a darker yellow hover. [Latest color capture](report-colors.jpg) supersedes the colors in the earlier captures below; tab switching and opening/closing Ask were checked in the browser.
- Removed document and tab-panel page frames, fixed paper styling, and shadows. Reports and supporting views share a pageless white surface. Individual charts can remain bounded objects.
- Returned **Core Metrics** to a persistent bottom disclosure. Metric selection and the explorer are shared across tabs; selecting a metric in Data opens the same drawer.
- Added onboarding within Reports. **New → Use example → Draft → Preview → Keep** demonstrates drafting into the same editor, with the same logo, navigation, toolbar, AI drawer, and Core Metrics. Source entry is optional. Cancel returns to the existing report.

## Review

Open the [prototype source](../2026-09-07/ux-proposal/index.html), or the running [local preview](http://127.0.0.1:3135/ux-proposal/?v=20260915d).

1. Inspect the report's pill tabs, original logo, and borderless reading surface.
2. Open Core Metrics, select a metric, and switch tabs. The bottom drawer remains available.
3. Choose New. Draft from the prepared example, review the suggestion, and Keep it to return to the document.
4. Try Rewrite → Preview → Discard; the original text remains in place.

| Desktop | Phone |
|---|---|
| [Report](report-desktop.jpg) | [Report](report-mobile.jpg) |
| [Onboarding](onboarding-desktop.jpg) | [Onboarding](onboarding-mobile.jpg) |
| [Core Metrics](core-metrics-desktop.jpg) | [Core Metrics](core-metrics-mobile.jpg) |

Additional captures: [Data](data-desktop.jpg), [Actions](actions-desktop.jpg), [Impact](impact-desktop.jpg).

## Verification

Browser checks covered 1280 px desktop and 390 px phone layouts; all four tabs; the persistent metrics drawer and selection; source disclosure; New/Draft/Preview/Keep; cancellation; and Rewrite/Preview/Discard. Static checks passed for JavaScript syntax, unique element IDs, ARIA references, the local logo asset, and the policy preventing network calls. The backend diff is empty. The application and engine suites were not rerun for this standalone prototype change. Screen-reader conformance, real AI generation, saving, and production acceptance are not claimed.

This revision supersedes the original proposal's colors, square tab shapes, paper frame, and placement of the metric explorer. The [original UX review](../2026-09-07/UX_REVIEW.md) remains the broader recommendation backlog.
