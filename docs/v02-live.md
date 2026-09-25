# Hacker News live discussion adapter

## Host integration

`src-tauri/src/live.rs` is a self-contained backend adapter using existing dependencies. No Cargo, services, database, IPC, or frontend changes are required *inside the adapter*. Register it and own one shared instance in the host:

```rust
pub mod live;

// Backend field, created once rather than per window/profile/request:
live: Arc<live::LiveDesk>,

// Backend::new:
live: Arc::new(live::LiveDesk::new()),

// Inside the existing async backend dispatch:
"live_status" => Ok(self.live.status()),
"live_set" => {
    let enabled = request["enabled"].as_bool().ok_or("enabled must be a boolean")?;
    Ok(self.live.set_enabled(enabled))
}
```

Public API:

- `LiveDesk::new() -> LiveDesk`: off, no network, no saved opt-in.
- `status(&self) -> serde_json::Value`: synchronous clone of the shared bounded snapshot; no network or database activity.
- `set_enabled(self: &Arc<Self>, enabled: bool) -> Value`: synchronous, idempotent toggle returning immediate status. Enabling must be called within the host's Tokio runtime; otherwise it remains off with an explanatory message. Disabling does not require a runtime.

Call `set_enabled(false)` when intentionally shutting down/replacing the backend. The worker holds an Arc while running; merely dropping one host reference is not a shutdown signal. Disabling clears memory, wakes the worker, and cancels the entire connection/hydration/backoff future. A generation check under the snapshot lock rejects stale writes. An async worker gate ensures rapid disable/enable sequences do not run overlapping stream workers. Multiple windows should poll this one local IPC snapshot, not independently enable internet subscriptions. No Tauri event emitter is required.

The fixed stream is an **opt-in public discussion source**, not verified reporting, a publisher-latency SLA, or an exhaustive HN archive. Show the discussion/source label and original links. Treat titles and author names as text, never HTML. Do not route these items into briefing/AI ingestion by default.

## Status and timestamps

```text
{
  enabled: boolean,
  state: "off" | "connecting" | "connected" | "backoff",
  lastEventAt: ISO-8601 UTC | null,
  lastItemAt: ISO-8601 UTC | null,
  retryAt: ISO-8601 UTC | null,
  message: string,
  items: [{
    id: number, title: string, url: string, discussionUrl: string, by: string,
    publishedAt: ISO-8601 UTC, receivedAt: ISO-8601 UTC, score: number,
    sourceId: "hacker-news", sourceLabel: "Hacker News",
    contentKind: "discussion", aiAllowed: false
  }]
}
```

- `publishedAt` is the HN item's upstream `time`; it is not a locally measured stream latency.
- `receivedAt` is first successful metadata receipt in this in-memory collection. Revalidation and reconnect duplicates preserve it.
- `lastItemAt` is the last previously absent story metadata receipt, including initial hydration. It is **not a publication event counter**.
- `lastEventAt` is receipt of a complete SSE event/comment heartbeat. Keep-alive frames do not fetch items or update `lastItemAt`.
- A connection's first Firebase snapshot is explicitly labelled **initial snapshot (not new publications)**, including on reconnect. There is no fabricated replay cursor or `Last-Event-ID` header.
- Backoff retains existing items, which may be stale. Off/permission loss clears items and timestamps. `retryAt` is advisory wall-clock UI information; the actual delay uses Tokio's monotonic timer.

## Network and privacy boundary

Only these request targets are constructed:

- `https://hacker-news.firebaseio.com/v0/newstories.json` with `Accept: text/event-stream`.
- `https://hacker-news.firebaseio.com/v0/item/{positive-numeric-id}.json` for bounded metadata hydration.

The host is resolved with a three-second DNS deadline; **all returned addresses must be public**, and the validated addresses are pinned into reqwest. Private, loopback, link-local, reserved, IPv4-mapped IPv6 and special-purpose ranges are rejected. Proxy use and redirect following are disabled, HTTPS is required, and no credentials, cookies, referer or user-configurable fetch URLs are accepted. All 3xx responses stop the adapter. This deliberately fails closed if Firebase introduces a redirect; do not silently relax destination validation.

The adapter uses its own small public-address guard because the existing services client has a total request timeout unsuitable for a long-lived SSE body. It adds no crate and modifies no shared network helper. A reconnect resolves/pins afresh. A healthy connection reuses its pinned client for metadata requests.

HN item responses may supply `text`, `kids`, and other fields. The adapter discards them and retains only the projected fields above. It never follows `kids`, loads profiles, retrieves comment items intentionally, fetches linked article URLs, fetches media, writes SQLite, or invokes AI. Original story links are inert HTTP(S) links; unsupported schemes and credentials fall back to the HN discussion permalink. The UI's existing explicit external-open validation still applies.

## Bounds and stream semantics

| Bound/default | Value |
|---|---:|
| In-memory displayed stories | 100 |
| Initial snapshot hydration | First 20 unique IDs |
| Concurrent metadata requests | 4 |
| Total queued + in-flight IDs | 100 |
| Firebase list entries / highest accepted index | 1,000 / 999 |
| SSE frame bytes | 64 KiB |
| Accepted SSE chunk bytes | 128 KiB |
| Complete frames per processed chunk | 256 |
| Metadata response bytes | 128 KiB |
| DNS answers accepted | 1–32, all public |
| Connect timeout | 5 seconds |
| Stream HTTP headers / whole item request | 12 seconds |
| Stream idle read deadline | 60 seconds |
| Displayed-ID revalidation | 5 minutes, max 4 concurrent |
| Exponential jittered backoff | Starts at 0.5–1 second; normal ceiling 60 seconds |

The byte parser handles UTF-8 split across arbitrary chunks, LF/CRLF/CR line boundaries, optional initial UTF-8 BOM, comments, multiple `data:` lines, multiple events per chunk, and incomplete final frames. Invalid UTF-8, oversized input and malformed Firebase state trigger bounded reconnect rather than unbounded buffering.

The subscribed Firebase node is a scalar-ID list, not a generic arbitrary JSON tree. Root `put` accepts arrays, sparse numeric-key objects or null. Root `patch` updates/removes numeric indices; relative paths such as `/3` replace/remove one scalar ID. Null deletes the corresponding list entry; null root clears the list. Invalid/deeper scalar paths, nonnumeric IDs, oversize indices and malformed patches fail atomically without partially updating state. Stable IDs are deduplicated; later list updates hydrate newly appearing IDs only.

List eviction alone is **not item deletion**. Every five minutes, retained displayed IDs are revalidated even if no longer in `newstories`; null/dead/deleted/non-story metadata is removed. That deadline survives stream reconnects, so short-lived connections do not postpone revalidation indefinitely. The newest initial-window IDs are also eligible for conservative revalidation. Timers skip missed ticks rather than burst to catch up. Network outages can prevent deletion discovery; backoff/stale status must remain visible. This is not a guarantee of instantaneous deletion propagation.

When the bounded queue fills, excess candidates are not queued. Reconnect snapshots and conservative latest-window revalidation recover current top entries; the adapter intentionally does not promise exhaustive/durable history. Metadata failures stop the current hydration batch and enter stream-level backoff, preventing parallel retry storms. HTTP 429/408/5xx are retryable. `Retry-After` seconds and HTTP dates are minimum delays (dates rounded up, not early); a valid server minimum can exceed the normal 60-second cap. An unsupported cooldown beyond one year stops rather than truncating it. Backoff resets only after a connection attempt lasted at least 60 seconds, not merely after receipt of an initial snapshot.

Firebase `cancel` / `auth_revoked` and nonretryable HTTP access/redirect errors stop and clear the collection; the user must explicitly enable again. Raw upstream error bodies are not reflected into status or logged.

## Verification

The adapter's unit tests live in `src-tauri/tests/live/unit.rs`. `src-tauri/tests/live_adapter.rs` compiles the module directly, allowing testing before the parent host registers `pub mod live;`. Once registered, the same internal tests are also available under the library; use the commands below to avoid running the opt-in network probe twice.

```bash
cd src-tauri
cargo test --test live_adapter -- --nocapture
cargo clippy --test live_adapter -- -D warnings
cargo test --test live_adapter real_network_smoke -- --ignored --nocapture
```

Verified final scoped run: **18 offline tests passed, one network test ignored by default**; `cargo clippy --test live_adapter -- -D warnings` passed. The explicit ignored network test also passed.

Coverage includes fragmented/multiline/CRLF/BOM SSE, state/null/path updates and atomic rejection, byte/list/queue/cache caps, initial-20 and max-four hydration, duplicate merging, keep-alive timestamp separation, revoked/cancel handling, HTTP/Retry-After/jitter, private-address rejection, idle reconnect, revalidation across reconnects, prompt disable during idle/backoff, idempotent shared enables and rapid-toggle non-overlap. Synthetic tests are explicitly synthetic; they do not claim that the public service generated those change/deletion events.

### Real bounded network observation

Actual ignored-test execution on **2026-09-23** opened the production SSE endpoint, parsed its initial Firebase snapshot, and hydrated **20 real stories**:

```json
{"count":20,"firstId":49823038,"firstPublishedAt":"2026-09-23T21:47:19Z","firstReceivedAt":"2026-09-23T21:49:09.048Z","lastEventAt":"2026-09-23T21:49:08.891Z","lastItemAt":"2026-09-23T21:49:09.320Z","message":"Connected: initial discussion snapshot (not new publications)","observedAt":"2026-09-23T21:49:11.123Z","state":"connected"}
```

The final run passed in **2.43 seconds**, then disabled and confirmed the worker gate became available within its 500 ms assertion deadline. The test has a 27-second observation timeout plus bounded shutdown. **No second change event was observed in this short run.** This proves actual SSE initial delivery plus metadata hydration, not continuous change/deletion delivery, HTTP 429 behavior on the public service, or measured publication-to-reader latency. Those error/reconnect cases are deterministic offline tests.

## Primary references

- [Official Hacker News API](https://github.com/HackerNews/API): near-real-time Firebase data, story metadata, `newstories`, null/deleted/dead handling.
- [Firebase REST streaming](https://firebase.google.com/docs/database/rest/retrieve-data#section-rest-streaming): `text/event-stream`, `put`, `patch`, keep-alive, cancel and auth-revoked events; documented redirect behavior (this adapter rejects redirects rather than following unvalidated destinations).
- [Repository source research](v02-source-research.md#1-hacker-news-official-live-metadata-contract): official citations, rights restrictions and prior real-payload observations. Public API access does not grant rights to linked publishers' articles or user text.
