# Media service verification and integration

## Exact APIs and policy

- `pub async fn media::load_media(media: &serde_json::Value) -> Result<serde_json::Value, String>` accepts **one trusted stored item**, revalidates it, and returns `{kind, mimeType, bytes, dataUrl}`. `bytes` is a byte count, not an array. The data URL is standard padded Base64.
- `pub fn media::validate_media(value: &serde_json::Value) -> Result<(), String>` validates one item for DB/import. Item fields: required `kind` (`image`/`video`), `url`, `playback` (`inline`/`external`); optional `mimeType`, `caption`, `credit`. Unknown fields, markup/control characters in text, and text over 500 characters are rejected. Inline MIME, when present, must be an exact supported lowercase essence.
- Inline image formats: JPEG, PNG, GIF, WebP, at most **5 MiB**. Inline video formats: MP4 and WebM, at most **32 MiB**. SVG/HTML and generic binary MIME types are never accepted inline. Container signatures are validated, not full decoder/codec correctness.
- Loading is never automatic. The parent host must resolve the item from its article/source, enforce `mediaAllowed == true` and `storage == "excerpt"`, and reject renderer-supplied arbitrary URLs. Apply reasonable in-flight concurrency limits in the host.
- External items permit only the same safe HTTP(S) article destinations as existing services; they **cannot be loaded** by `load_media`. The UI must retain original-article/external fallback and must not navigate to data URLs as documents.
- Inline fetching uses the existing service HTTPS/443-only client, validates the entire DNS answer, pins those addresses, disables proxies/referrers/redirects, and sends no credential/cookie headers. All redirects are rejected. A 20-second outer timeout includes DNS, headers and body; existing per-client connect/request limits still apply. Both declared and streamed lengths are checked. Only HTTP 200, one supported Content-Type, and identity content encoding are accepted. Feed-declared MIME must match response MIME.
- Feed extraction is enabled only by `source.mediaAllowed == true && source.storage == "excerpt"`. Metadata-only, missing permission, and unknown storage are denied. No-media articles preserve the previous JSON shape (no added empty/null `media` field).
- `feed-rs` RSS enclosures, MediaRSS content/thumbnail/group metadata and Atom `rel="enclosure"` links are handled. At most eight unique safe items are retained, with bounded plain-text caption/credit. Supported media declared too large, HTTP media, unsupported `video/*`, HLS and DASH become external items. Unknown non-media MIME is omitted. No summary/body HTML scraping or player-script interpretation. Signed media query strings are preserved.

## Dependencies / wiring

The parent supplies `pub mod media;` and direct `base64 = "0.22"` (already present transitively). No additional dependency is needed. Installed `feed-rs 2.4.0` model/parser source was consulted before implementation.

Only these existing networking helpers were made `pub(crate)`: `services::public_url`, `services::canonical_url`, `services::public_client`, `services::bounded_body`. Their networking/security implementation and existing AI behavior were not changed.

## Reproduction

From repository root:

```text
cargo test --manifest-path src-tauri/Cargo.toml --lib media_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib services::
cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib media_live_nasa_apollo17_public_image -- --ignored --nocapture
```

For an isolated production-module harness while sibling modules are being integrated:

```text
python src-tauri/tests/media_run.py --nocapture
```

This compiles `tests/media/harness.rs` into `src-tauri/target/debug/media-isolated-tests.exe`. It obtains coherent dependency and native-library paths from Cargo JSON artifact messages, not guessed newest rlibs. It tolerates a root-module compile failure only when the dependency artifacts are available; it still compiles and executes the actual media/services modules. This does not edit a Cargo manifest. The older `service-tests` manifest/harness is outside this worker's ownership and needs parent wiring for the new sibling `media` module if retained.

## Observed RED / GREEN evidence

Each following behavioral slice was run RED before its implementation, then GREEN:

1. Valid media contract: `Err("Media validation not implemented")` instead of `Ok(())`.
2. Permitted RSS enclosure: article `media` was `Null` instead of the expected image item.
3. Atom enclosure/fallback: `missing Atom enclosures`.
4. MediaRSS bounds/attribution/deduplication: `left: 14`, `right: 8`.
5. Response data URL: `Err("Media loading not implemented")`.
6. Hostile/mismatched payload: `accepted 200 OK, Content-Type: image/png` for HTML bytes.
7. Supported synthetic JPEG/GIF/WebP/MP4/WebM signatures: MIME/magic rejection before those format cases were implemented.
8. External item: `fetched unpermitted item` before the pre-network external guard.
9. CDN content negotiation: broad Accept header failed the exact JPEG expectation; fixed to request the declared MIME or only supported formats of the stored kind.

Additional regression tests exercise declared/streamed image/video limits and pending-request/stalled-body deadlines. The unchanged service suite exercises mixed/private DNS, pinned clients, redirect policy, feed limits, AI scoping, cancellation and credentials. Fixture HTTP servers bind loopback **only in test code**; the production loader never accepts those endpoints.

## Real public-network evidence (not fixtures)

The ignored live test was explicitly run through **production `load_media`**, not curl or a mocked response:

- Asset: `https://www.nasa.gov/wp-content/uploads/2023/03/135918main_bm1_high.jpg`
- Attribution: NASA / Apollo 17; original page: https://www.nasa.gov/image-article/blue-marble-image-of-earth-from-apollo-17/
- NASA informational-use guidance reviewed: https://www.nasa.gov/nasa-brand-center/images-and-media/ ; the original page explicitly states `Image Credit: NASA`. No endorsement implied.
- Observed at `2026-09-23T21:22:29.425203500+00:00`: `image/jpeg`, **195439 bytes**, SHA-256 `ed620504dbb0cdf17185abed9a97afd7dbfaf816fb77bada0302cffbe39a007a`.
- First live attempt correctly rejected a CDN-generated WebP response to a JPEG-declared item. Restricting Accept fixed negotiation without relaxing MIME validation; subsequent live test passed.
- No downloaded asset is inserted into production DB or distributed as a fixture. This proves real host-side image retrieval and encoding, **not native rendering or live video playback**. MP4/WebM tests use deliberately minimal synthetic container signatures, explicitly not playable-video evidence.

At the recorded integrated check, `cargo test --lib` returned **39 passed, 0 failed, 4 ignored** (one live media test and the existing three explicit service ignores). Full root `cargo test` returned **82 passed, 0 failed, 4 ignored** across library/integration suites, including the backend worker's media/briefing tests. All-target Clippy `--all-targets -- -D warnings` and owned-file rustfmt checks passed. The isolated production-module harness returned **33 passed, 0 failed, 4 ignored**. Other workers may add tests after this record.
