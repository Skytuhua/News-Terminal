# Reader snapshot performance

## Scope and plan

The reader still serializes the full cache to reconcile articles and detect search
and briefing input changes at baseline `8834fbc20240917abdd7dce3846eb2c541b7d975`.
This change replaces those comparisons with structural sharing and value checks.

1. Compare every article field, including nested data, before reusing its identity.
2. Track briefing inputs from the authoritative snapshot before the visible stream
   defers arrivals or preserves its current order. Keep the existing input fields.
3. Track search changes from accepted articles, excluding only read and saved state.
4. Reuse navigation and page projections when their inputs have not changed.
5. Check field coverage, ordering, read state, pending arrivals, pagination and stale
   responses. Measure the old and new comparison paths on the same synthetic cache.

The change does not alter native operations, write queues, snapshot generation
checks, settings, article schemas, UI styling or the 100-row page limit.

## Behavior

`reconcileArticles` compares the complete JSON value of each article. It reuses
unchanged objects and returns the previous array when all rows and their order
match. Nested history, media, classification fields and unknown wire fields take
part in the comparison. Object key order and absent versus undefined object
properties describe the same JSON data. Array order remains significant.

The incoming snapshot is reconciled before the visible list preserves its current
order and defers new stories. A shallow snapshot copy retains those authoritative
article references for the next briefing comparison. The visible projection cannot
change that stored article array. A small revision replaces the briefing's former
JSON string, using exactly the same preference, source and article fields.

Search compares accepted articles after that projection. Only top-level `read`
and `saved` markers are excluded. A content correction with an unchanged timestamp
still invalidates search; a pending arrival does not enter its results until the
reader accepts it. When search does rerun, its host-provided ranking still applies.

Unchanged watchlists keep their identity. The collection memo depends on the tab
fields used by its filter, so selected-story persistence does not repeat the full
filter. Navigation rows, their history ID set and page slices are reused until
their inputs change. Read markers still update unread badges and J/K history.

The comparison helpers expect immutable JSON snapshots from IPC. The reader does
not write optimistic changes into those snapshots. Load-generation and database
replacement checks still reject stale responses before they can update either
the authoritative or accepted cache.

## Comparison measurement

`tests/reader-performance.bench.mjs` imports the old model and extracts the old
fingerprint expressions from the specified baseline. It runs both comparison
paths on the same fixture and checks accepted data, order, pending arrivals,
identity reuse and search/briefing invalidation before timing them.

The local run on 2026-10-18 used Node v24.19.0 on Linux x64, with an AMD EPYC 9V74
CPU reported by the environment. The synthetic snapshot contained 5,000 articles
and occupied 5,227,935 JSON bytes. Each case received three warmup runs followed by
nine samples per implementation, alternating which implementation ran first.
Fixture construction and IPC cloning were outside the timed section.

| Comparison path | Before median [p25, p75] | After median [p25, p75] |
|---|---:|---:|
| Unchanged readback | 59.45 [58.61, 60.57] ms | 16.48 [15.34, 17.75] ms |
| One read marker | 59.53 [58.20, 61.49] ms | 15.40 [15.01, 16.61] ms |
| Corrected excerpt, unchanged timestamp | 66.03 [59.23, 67.10] ms | 16.71 [15.12, 17.29] ms |
| Pending arrival and authoritative reorder | 58.36 [57.58, 62.62] ms | 15.68 [15.61, 16.15] ms |

All 5,000 accepted article objects were reused for an unchanged readback and a
pending arrival with a reordered authoritative list. Updating one marker or
excerpt reused 4,999. Both implementations agreed on every checked result.

These measurements cover the Node comparison pipeline. They do not measure React
rendering, browser interaction latency, WebView2, native IPC, SQLite, feed refresh
or AI work. The historic September browser timings in
`docs/v05-performance-baseline.md` are a separate experiment and are not a before
sample for this change. No native or whole-application speedup is claimed.

Reproduce against a checkout that contains the baseline commit:

```text
node tests/reader-performance.bench.mjs --baseline=8834fbc20240917abdd7dce3846eb2c541b7d975 --samples=9
```

The local environment used `--baseline-dir` with the verified source mirror of
that commit because its Node child-process launcher could not invoke Git. The
benchmark records source hashes and refuses a successful result if the current
model, App or probe changes during measurement.

### Local measurement provenance

Completed at `2026-10-18T09:13:10.560Z`; source changes during run: none.

| Input | SHA-256 |
|---|---|
| Baseline model | `93c937ed3c403d713b296393e0465d55a709b1352967b001bb9f8b593106151e` |
| Baseline App | `f7fa937173ea9a20184768b0ee2854fcc6bc7aa679b28ae631384ee0d3b2f83b` |
| Updated model | `41d6d42501a42ef23ef4450858cf294beb08b1ba6d664609cbea2e56d34085ea` |
| Updated App | `2be00d18ec21a6adf4d32d505e7e20e5a879801e9cbffe7003fc1322f9097875` |
| Probe | `dd6c64da97bb524ec8d6b8eb9d36266041143cc135aef8cbf6106f8742e7ac03` |

Raw samples in milliseconds, rounded here to three decimals:

| Case | Before | After |
|---|---|---|
| Unchanged | 79.144, 62.718, 58.607, 60.572, 59.966, 57.221, 59.453, 57.556, 58.978 | 17.748, 16.483, 18.561, 18.467, 16.781, 15.848, 15.304, 14.476, 15.338 |
| Read marker | 57.996, 58.833, 58.196, 57.513, 61.495, 59.525, 59.672, 64.164, 64.197 | 15.010, 15.998, 15.384, 14.600, 15.396, 14.583, 17.081, 18.277, 16.613 |
| Corrected excerpt | 67.095, 59.232, 61.725, 66.031, 69.191, 92.067, 66.738, 57.292, 57.675 | 14.231, 15.202, 17.331, 16.708, 17.295, 17.576, 17.274, 15.121, 14.165 |
| Pending and reorder | 65.161, 57.915, 63.189, 57.579, 56.390, 54.771, 58.357, 59.466, 62.620 | 16.144, 15.100, 18.673, 15.164, 15.678, 15.654, 16.597, 15.609, 16.149 |

## Regression verification

Native Node assertions passed for authoritative changes and fingerprint
equivalence across all 26 Article fields, unchanged identity reuse, object keys,
undefined properties and ordered arrays. The benchmark's four differential cases
also passed. `git diff --check` passed.

`tests/reader-performance.test.ts` adds exhaustive typed field cases, nested and
unknown wire fields, insertion/deletion/reorder behavior, preference and source
policy changes, and a 5,000-article case that throws if a comparison serializes
anything.

`tests/e2e/reader-performance.spec.ts` covers a selected page at 5,000 stories,
read/saved markers without repeated search, deferred arrivals, same-timestamp
corrections and native search ranking, authoritative pending briefing inputs,
and an older profile snapshot arriving during a profile switch. It also counts
cache serialization calls independently of the fixture's own persistence.

The complete local checkout passed TypeScript and all 16 focused model tests.
All 16 browser cases also passed with Chrome for Testing 155 on Linux: the three
new performance cases plus `daily-loads`, `daily-reading` and every
`v02-review-regressions` case. This includes race, profile-switch and briefing
invalidation coverage. Browser execution took 35.4 seconds. Windows CI and
native WebView2 acceptance remain separate verification gates.
