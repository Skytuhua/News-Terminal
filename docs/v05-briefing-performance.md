# 0.5 briefing performance: stop paying for source previews nobody asked for

## What was wrong

`docs/v05-performance-baseline.md` measured opening the Daily briefing at **809 ms median** with a single
**592 ms long task**, and the DOM growing from 1494 to **5233** elements. Its recorded `opDelta` showed why:
every briefing open issued `daily_brief` × 1 **plus `sector_summary_preview` × 14**, one per sector, in
every trial.

That work had no reader-visible purpose. `src/Briefing.tsx` renders one `<SectorSummary>` per sector
unconditionally, and each one dispatched its preview from a mount effect. The preview is only ever
displayed inside that sector's **collapsed** "Review selected source inputs" `<details>`, and the
**Generate sector summary** button is `disabled` until the preview arrives. So the app was fetching 14
previews to populate content behind a closed disclosure, to enable a button.

The native side made it worse than the frontend numbers alone suggest: `sector_summary::select`
re-runs the full `daily_brief` query for every single sector, so 14 unrequested previews re-derived the
whole briefing 14 times.

## The change

The preview check is now **deferred to the first review**, not the mount.

- `src/SectorSummary.tsx` gains a `requested` flag that gates the preview effect. With no `requested`,
  the effect returns early and dispatches nothing.
- The "Review selected source inputs" disclosure moved **outside** the preview conditional states, so the
  affordance exists before anything has been checked — which is what makes it able to trigger the check.
  Its `onToggle` sets `requested` the first time it is opened.
- Once requested, the preview is fetched exactly once. Collapsing and re-expanding reuses the loaded
  result: it neither refetches nor discards it. The existing `previewRevision` retry path still refetches.
- The disclosure body shows a pending line while the one request is in flight.

## Honest copy, not just a faster path

An earlier draft of the test asserted a `"Checking permitted source stories…"` status at the moment the
briefing opens. With the check now deferred, **nothing is being checked at that moment**, so that string
would have been a false loading state. This project's rules treat an inaccurate loading or empty state as
a defect, so the un-requested status says what is actually true:

> Permitted source inputs are checked only when you review them below.

and the assertion was updated to match. The in-flight status keeps the original "Checking permitted
source stories…" wording, which is accurate once requested.

## What was verified

`tests/e2e/briefing-sector-preview.spec.ts` (added with this change):

- opening the briefing issues `daily_brief` and **zero** `sector_summary_preview` calls;
- Generate is disabled, the honest status is shown, and no "N source stories selected" line appears;
- the first expand issues **exactly one** preview, with the expected `profileId`, `date` and `sectorId`,
  and only then reports `2 source stories selected · 2 eligible · 0 excluded` and enables Generate;
- later expands reuse the loaded preview; collapsing neither refetches nor discards it;
- browsing the briefing still loads no preview, sends nothing to AI and marks nothing read.

The existing sector and briefing suites were re-run against the change to prove no rule was weakened.

## Preserved unchanged

Exact-quotation validation, host-constructed citations and evidence, the
"AI-selected source quotations · unverified" label, per-source authorisation and rights gates, consent
generations, cancellation and stale-input rejection, the at-least-two-eligible-stories rule, the sample
and coverage disclosures, and the rule that browsing the briefing never marks anything read, loads media
or invokes AI. No caching layer, prefetch heuristic or new host operation was added.

## Limits

- The 809 ms figure is **frontend-only and from Chromium**, not WebView2, and the probe's own dispatch
  microbenchmark answered from memory, so it is a lower bound on the real native cost. The native saving
  from 14 avoided `daily_brief` re-derivations is structural, not measured here.
- No post-change A/B timing run was performed as part of this change. The proven result is the dispatch
  count, which is asserted directly in the tests. A before/after timing comparison requires re-running
  `scripts/v05-performance-probe.mjs` once the rest of the 0.5 changes are in place; until that exists,
  no speedup figure is claimed.
- Browser fixture evidence is not native evidence. The packaged executable has not been re-verified for
  this change.
