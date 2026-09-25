# Service verification

Service fixtures are synthetic and never enter the production database. Run `cargo test --manifest-path src-tauri/service-tests/Cargo.toml` for the isolated service suite (same services.rs compiled by the native application).

Official adapter references reviewed 2026-09-23: [Ollama chat](https://docs.ollama.com/api/chat), [Gemini generateContent](https://ai.google.dev/api/generate-content), [Groq OpenAI compatibility](https://console.groq.com/docs/openai). No upstream implementation copied. Provider/model availability and billing are user-account dependent; the application cannot determine whether a key has paid billing. Enabling a cloud provider explicitly permits that provider on demand, including fallback in configured order; there is no built-in paid provider or automatic key acquisition.

## Actual test-first evidence

Evidence is appended as each behavior is implemented; incomplete entries must not be read as passing.
