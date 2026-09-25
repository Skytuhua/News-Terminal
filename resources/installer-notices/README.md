# Windows installer component notices

These notices supplement, and do not replace, `licenses/` and
`THIRD_PARTY_NOTICES.md`. They concern the NSIS installer/uninstaller, not the
application's Cargo/npm inventory.

## Components

- **NSIS 3.11** installer/uninstaller engine, zlib decompressor, standard plug-ins
  (`System.dll`, `nsDialogs.dll`, `StartMenu.dll`, `LangDLL.dll`), default UI
  resources and wizard bitmap: preserve `nsis-3.11/COPYING` in full.
- **NSIS Modern UI 2**, copyright 2002–2025 Joost Verburg:
  `nsis-3.11/Modern-UI-2-License.txt` is the exact notice shipped in the NSIS
  archive, including its original Windows text encoding. The additional
  `Modern-UI-License.txt` is the upstream Modern UI notice at the NSIS 3.11
  source commit; it is not a substitute for the Modern UI 2 notice.
- **nsis-tauri-utils 0.5.3**, copyright 2019–2022 Tauri Programme within The
  Commons Conservancy: `nsis-tauri-utils-0.5.3/LICENSE_MIT` and
  `LICENSE_APACHE-2.0` are unmodified upstream texts. Its workspace declares
  the alternative MIT or Apache-2.0 license; both texts are preserved, not
  asserted to be cumulative requirements. The upstream manifests are kept
  alongside them as provenance, not as a resolved dependency inventory.
- **Tauri 2.11.5 installer template/helpers**: `tauri-template-LICENSE_MIT`
  preserves the upstream MIT notice.

NSIS COPYING also contains bzip2 and LZMA/CPL terms. It is preserved unabridged;
that does **not** assert that those compression modules are present in this
zlib-configured installer.

## Provenance and review limits

`provenance.json` records download URLs, hashes and byte comparisons against the
actual cached toolchain. The Tauri bundler pins NSIS 3.11 and the 0.5.3 plug-in:

- https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs
- https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip
- https://github.com/kichik/nsis/tree/7359413009afd4f0fff472d841fc2f2cc0e0a5f8
- https://github.com/tauri-apps/nsis-tauri-utils/releases/tag/nsis_tauri_utils-v0.5.3
- https://github.com/tauri-apps/nsis-tauri-utils/tree/13d9edd27b69310e108d6fbd49f90992f8a05390

`diagnostic-payload-evidence.json` describes an explicitly labeled diagnostic
compile and extraction, not a certificate for the final release artifact.
See the repository's `docs/installer-payload.md` for reproduction and final
release checks.

The downloaded nsis-tauri-utils DLL is byte-identical to its pinned release.
That identifies the artifact but does not prove a reproducible source build or
its complete statically linked dependency versions. The upstream source tag has
no Cargo.lock; its manifests declare semver `1.0` and windows-sys `0.61.2`
(version requirements, not proof of resolved versions). A release SBOM/lockfile
or a controlled rebuild is still needed to close that precise dependency
provenance gap. The application's separately generated Cargo inventory must
not be treated as the plug-in's build inventory.

This package is factual attribution and provenance evidence, not blanket legal
clearance. No Microsoft WebView2 runtime/bootstrapper or VC redistributable
installer is intended to be redistributed in the zlib/skip configuration.
