# Contributing to News Terminal

News Terminal is a Windows desktop reader. Useful contributions improve daily reading, fix reproducible problems, clarify documentation or add sources with reviewed permissions.

## Before you start

[Open an issue](https://github.com/Skytuhua/News-Terminal/issues/new/choose) for a bug, feature request or feed suggestion. Include the reading problem and a concrete example. For larger changes, describe the proposed scope before investing in implementation. Small fixes and documentation corrections can go straight to a focused pull request.

Keep the compact reading layout, keyboard access and stable reading position. [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) explain the product and interface expectations.

## Set up a checkout

The native app requires Windows, Node.js 24/npm, stable Rust with the MSVC toolchain, Visual Studio C++ build tools/Windows SDK and WebView2. Follow the [Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows), then:

```sh
git clone https://github.com/Skytuhua/News-Terminal.git
cd News-Terminal
npm ci
npm run tauri -- dev
```

`npm run dev` starts only Vite; it does not provide the native host. Browser tests use labeled fixtures through a test-only mode. Passing them does not establish Windows, live-feed or local-model behavior.

## Verify your change

For frontend behavior:

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

You can run a focused browser journey with `npm run test:e2e -- tests/e2e/reader.spec.ts`. Include meaningful regression coverage for behavior changes and inspect affected keyboard, empty/error and narrow-window states. For documentation-only changes, check links, examples and any issue-form YAML.

For Rust changes, run on Windows:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The [developer guide](docs/development.md) covers isolated browser ports, source/catalog checks, license notices and native smoke commands. Native/window, installer or runtime changes need the corresponding Windows evidence. State the platform and revision tested; distinguish browser fixtures, native fixtures, live feeds and real model inference.

## Preserve the host and permission boundaries

- Rust owns networking, SQLite, credentials, AI, notifications and native windows. Keep renderer operations within the typed [IPC contract](docs/IPC-CONTRACT.md), including workspace revisions and replacement tokens.
- Feed access, excerpt storage, media display, AI processing and redistribution have separate permissions. Preserve source links and attribution; a public feed alone does not grant every use. Follow the [source policy](docs/source-policy.md).
- Keep credentials, private backups, personal reading data and local AI runtimes/models out of commits and issue attachments. Use labeled synthetic data for reproducible fixtures.
- Keep dependency lockfiles with dependency changes. Preserve [third-party notices](THIRD_PARTY_NOTICES.md) and document any added terms.

Feed suggestions should include the publisher's official HTTPS RSS/Atom URL, language/topic, terms or permission references, and known storage/media/AI restrictions. State what remains unknown.

## Send a pull request

Describe the user-visible problem and resulting behavior, then list the checks actually run and any remaining limitations. Include screenshots for visible changes, labeled with the platform and whether they use fixtures. Keep the diff focused and update relevant documentation.

Current downloads are unsigned Windows x64 development builds, with no published tagged release. Building an executable is separate from release acceptance; follow [installer payload verification](docs/installer-payload.md#current-release-owner-sequence) before preparing distribution artifacts.

Contributions are made under the repository's [MIT license](LICENSE). Publisher material and dependencies retain their separate terms.
