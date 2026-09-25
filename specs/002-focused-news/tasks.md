# Focused free news terminal tasks

This file tracks the approved 15-task execution surface from `.hermes/plans/2026-09-24_132440-focused-free-news-terminal.md`.

1. Acceptance contract and source-cost rules: implemented in this spec, catalog tests, source docs and verification report.
2. Section classification and backward-compatible tab fields: implemented in Rust/TS models, backup validation and tests.
3. Cached classification migration: implemented with identity/state-preserving reclassification tests.
4. Four-group navigation and matching briefing payload: implemented for workspace navigation and briefing input sections; deeper sector UI follow-up is documented.
5. Centralized limits and zero-paid mode: source cap raised to 300 and cloud AI execution blocked server-side.
6. Feed bundles: catalog expanded and machine-checked; exact counts in verification report.
7. Source directory/health filters: settings show counts, access mode, adapter, publisher and image-review status.
8. Item-scoped media authority: preserved existing exact-asset authority and catalog media allowlists; no blanket media permission.
9. Thumbnail loading/cancellation: headline rows use explicit host-mediated `media_load`; full decoder-resize expansion remains a documented shortfall.
10. Visual rows and consent controls: implemented opt-in row thumbnails and reader media tests.
11. OpenRouter discovery: implemented metadata IPC, parser and UI panel with no inference.
12. Benchmarks: implemented Arena and SWE-bench panels with separate licenses/methods.
13. Social coverage: Mastodon/Lemmy/YouTube official feeds preserved; Bluesky/Reddit/X kept link-only with explicit limits.
14. Fairness, deduplication and scale: source cap and paging/search bounds preserved; full performance probe to be run as release evidence.
15. Migrations, regression, native acceptance and handoff: docs and smoke harness added; final verification results recorded in `docs/focused-implementation-verification.md`.
