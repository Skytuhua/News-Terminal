# Service verification harness

This small Cargo package compiles the **same** `../src/services.rs` as the Tauri host, without requiring the desktop shell. Its Cargo manifest/harness were inherited, inspected, and reused; no additional dependency was required. Fixtures are test-only Rust values and local HTTP responses, never production news or generated AI results.

Run from the repository root:

```sh
cargo test --manifest-path src-tauri/service-tests/Cargo.toml
cargo clippy --manifest-path src-tauri/service-tests/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/service-tests/Cargo.toml -- --ignored --nocapture
```

The last command opts into three side-effecting/environment-dependent checks:

- Fetch a live USGS public-domain earthquake Atom feed. Permission reference: https://www.usgs.gov/faqs/are-usgs-reportspublications-copyrighted . Feed policy: https://earthquake.usgs.gov/earthquakes/feed/policy.php . Verification uses metadata-only storage and USGS attribution.
- Bind loopback port 11434 to a clearly labeled **Ollama HTTP fixture**, not a live model. It fails rather than interfering if Ollama already occupies that port.
- Save/read/remove a unique, non-secret fixture in Windows Credential Manager. Existing provider credentials are not modified.

## Actual execution evidence

- Unit/HTTP fixture suite: **22 passed, 0 failed, 3 explicitly ignored by default**.
- Explicit ignored suite: **3 passed, 0 failed**. The live USGS run returned **244 entries**; live feed counts and titles naturally change.
- Strict harness Clippy: passed with `-D warnings`.
- RED/GREEN cycles were executed for plain excerpts; RSS parsing; Atom metadata permissions; SSRF/private/mixed DNS rejection; conditional GET/304; successful feed HTTP parsing; streamed body cap; Retry-After; redirect/pinned destination validation; separate AI permission; scoped opt-in request builders; Windows credentials; provider response formats; pre-request cancellation; in-flight body cancellation/timeouts; consented fallback; local adapter HTTP; XML DOCTYPE denial; encoded credential/truncated output rejection; unsafe article links; and relative Atom links. Initial failures were real assertions against minimal missing implementations, followed by passing executions.
- A root Tauri `cargo check --lib` reached the service module but was blocked by existing/concurrent `native.rs` errors (String/&str mismatch and mutex-guard lifetime); this harness does not claim a successful desktop build.
- **No live Gemini/Groq model inference was performed:** no real credentials were available. No cloud AI request or paid fallback was made. The local adapter check is a fixture, not proof of an installed Ollama model.

## Bounds and security contract

- Feed: public HTTPS port 443; credential-free URLs; DNS lookup timeout 3 seconds; connection timeout 5 seconds; request timeout 15 seconds; whole operation 20 seconds; at most 5 redirects; at most 2 MiB streamed response and 500 entries.
- Every redirect is separately URL-checked, DNS-resolved, and checked against private/reserved ranges. A mixed public/private answer fails closed. The validated addresses are pinned in reqwest; redirects and proxies are disabled in that client. No validate-then-re-resolve gap.
- Only native IPv6 global unicast is accepted, excluding documentation, transition, and special-purpose ranges. This is deliberately conservative. UTF-16/XML DOCTYPE/entity declarations are rejected; a normal RSS/Atom parser handles permitted XML. No article page is fetched.
- Feed excerpts are plain text with tags and active-content bodies removed, capped at 2,000 characters. Headlines cap at 500. Missing/invalid publication dates remain null, never replaced by ingestion time or Atom updated time. Relative links resolve against the final feed URL. Only known tracking fields/fragments are stripped.
- Retry-After is reported through the unchanged `Result<Value,String>` interface as `HTTP 429; retry after N seconds` (also 503), accepting delta seconds or HTTP dates and clamping to 1–86400 seconds. No response body/raw transport error is returned. The backend already parses this string form in `source_failed`.
- AI: `aiAllowed` must be exactly true; explicit `storage:metadata` fails closed. Provider `enabled` **and** `consented` must be true. No default provider/model. At most 8 configured attempts, 20 seconds per attempt and 45 seconds overall, cancellation checked before polling and while reading with a 50ms polling interval.
- Ollama is fixed to `http://127.0.0.1:11434/api/chat`; cloud-model names are rejected. Gemini/Groq destinations are fixed HTTPS origins, with validated model names, OS-stored BYOK credentials in sensitive headers (never query parameters), no AI redirects, no provider-supplied endpoint override.
- Only a whitelisted headline, permitted excerpt, source attribution and original link enter the prompt; no history, preferences, full article, tools, or fetched page. Response cap is 64 KiB, generation cap 512 tokens, visible output cap 4,000 characters; incomplete/empty/secret-echo responses are rejected. Prompt instructions treat source text as untrusted, but factual quality is not guaranteed.
- Windows Credential Manager namespace is `NewsTerminal.AI`; save verifies exact readback, and only `hasKey` crosses the interface. Other OSes fail closed. No credential deletion API was added because the public contract does not define it.

## Host integration requirements / limitations

1. **Current source policy is authoritative.** The Article wire type does not include storage. Before `summarize`, the host must reject a current source whose `storage` is `metadata`, or attach that source storage as a transient `article["storage"]` value. The service cannot reconstruct current source policy from an Article alone. It independently rejects absent/false `aiAllowed`, and ingestion never stores metadata-only excerpts. Do not infer AI rights from source enabled/read permission.
2. Gemini/Groq offer BYOK access, not a client-verifiable free-billing guarantee. The provider account/key/model determines billing and availability. UI consent must explain this; use an account without paid billing for a strict free-tier setup. There is no automatic model upgrade, paid provider default, or secret-in-config fallback.
3. Bound DNS/OS credential waits return promptly, but an OS resolver/credential blocking task already started may finish in the background after cancellation. It cannot initiate a dropped HTTP request. No credentials are printed or returned.
4. Full desktop release verification belongs to the host integration; this package proves the service implementation independently.
