# Headless core regression harness

This package imports the production `rights`, `db`, `intelligence`, `briefing`, `media`, `services`, `sector_summary`, and `topics` modules through `#[path]` declarations. It also runs the production `tests/backend.rs` integration suite. It does not replace any implementation or remove the unit tests declared by those modules.

Run from the repository root:

```sh
cargo check --manifest-path src-tauri/core-tests/Cargo.toml --locked
cargo test --manifest-path src-tauri/core-tests/Cargo.toml -- --list
cargo test --manifest-path src-tauri/core-tests/Cargo.toml
cargo clippy --manifest-path src-tauri/core-tests/Cargo.toml --all-targets -- -D warnings
```

The image dependency enables the same JPEG, PNG, GIF, and WebP codecs as the desktop package. `serde` and `tempfile` are normal dependencies because production database backup code uses them outside tests. Imported database, service, and sector-summary modules allow unused code only because some entry points are called exclusively by the desktop host.

The default test command leaves live network, local-model, and credential checks ignored. This harness covers its imported production modules; the Tauri host and other native modules require the main package's checks.
