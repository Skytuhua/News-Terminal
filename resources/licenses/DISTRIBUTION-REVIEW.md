# Distribution evidence and release duties

This is a factual implementation/evidence review, not legal advice or a certification that a final installer is compliant. Scope is the current locked graph and `x86_64-pc-windows-msvc`; an installer/binary link-map audit remains a release duty.

## Resolved Windows license-text gaps

The twelve originally missing Windows normal/build package notices are now supplied under `upstream/`, with package version, Cargo checksum, source URL, exact `.cargo_vcs_info.json` revision and SHA-256 in `upstream/manifest.json`. Eleven packages use complete project-root license files from their own published VCS revision, rather than guessed copyright lines or a license from a different version. UNIC's project COPYRIGHT.md is included alongside both offered license texts. `unic-ucd-ident` has a different revision from the other four UNIC crates; its own revision is retained.

`selectors 0.36.1` is the explicit exception: its pinned `servo/stylo` revision has no full repository MPL text. Its published `lib.rs` carries the MPL-2.0 source header and official license URL. The full official Mozilla version-2.0 text is supplied as `upstream/selectors-0.36.1/LICENSE-MPL-2.0.txt`; this is not misrepresented as a file fetched from that Git revision. The crate's original source header remains intact in its bundled source archive.[1]

Thirty packages lacking named license texts remain individually visible in `README.md` and `inventory.json`. All are outside the selected Windows closure (`other-target-or-resolved-optional-supplement`); none is silently excused inside the Windows runtime/build set. These are not established as distributed by this Windows build; the label does not assert that they are unused on every target or feature selection. Do not use this result to approve a Linux/macOS/Android/GNU-Windows distribution. `--strict` intentionally fails for these all-target gaps; `--strict-windows` fails for any missing Windows or included npm notice/declaration.

## WebView2 loader: actual Microsoft SDK artifacts

The exact `webview2-com-sys 0.38.2` revision's update tool identifies Microsoft.Web.WebView2 **1.0.3650.58** and copies its loader libraries from the NuGet SDK. The captured update-tool source provides the version provenance.[3]

The SDK was downloaded from the official versioned NuGet endpoint. Its `.nuspec` explicitly points to `LICENSE.txt`. That license is Microsoft's BSD-style redistribution grant (copyright retention, binary reproduction of copyright/conditions/disclaimer, and no endorsement using Microsoft's/contributors' names without permission), not the Rust wrapper's MIT license. The unmodified LICENSE.txt and NOTICE.txt are packaged under `upstream/webview2-sdk/`; preserve both with the executable. The complete SDK NOTICE is retained conservatively, not a claim that every SDK component mentioned there is linked into this application.[2]

All nine loader files (DLL, import library, static library for x64, x86 and arm64) were compared byte-for-byte between the official NuGet package and the resolved crate. Their individual hashes, sizes, NuGet member paths and package hash are in `upstream/manifest.json`. The offline generator rechecks the actual crate files against those hashes. The full SDK package is deliberately not bundled: only its license/NOTICE, package metadata and version evidence are needed here. The crate's `src/lib.rs` selects `WebView2LoaderStatic` for MSVC and the DLL for non-MSVC; the selected x64 static library is therefore within this review's evidence scope. This describes build inputs, not a verified final executable link map.

**Separate runtime/installer gate:** WebView2 Runtime is not the WebView2 loader SDK. These SDK terms do not purport to license an Evergreen bootstrapper, Evergreen offline runtime, fixed-version runtime, VC runtime or installer engine. Before distributing any such artifact, identify the exact artifact/version and its applicable terms. An OS/user-installed runtime is not thereby redistributed by this notice bundle. No installer or runtime binary was added by this task.

## MPL source availability implemented, not merely referenced

MPL sections 3.1 and 3.2 require covered source to remain under MPL, tell executable recipients how to obtain that source by reasonable timely means, and preserve source rights despite other executable terms. Section 3.4 protects the existing notices; section 3.3 permits a larger work under other terms while retaining the covered-code obligations.[1]

The bundle includes complete published source archives for **cssparser 0.36.0, cssparser-macros 0.6.1, dtoa-short 0.3.5, option-ext 0.2.0, and selectors 0.36.1**, plus `SOURCE-NOTICE.md` addressed to recipients. It identifies the included archives, exact versioned upstream downloads and Cargo.lock SHA-256 checksums. This conservative set includes the procedural macro crate rather than assuming no relevant emitted code. No AGPL reference code is included.

The offline check verifies each archive's bytes against Cargo.lock, compares every archive member to the actual Cargo-resolved source, and rejects additional local source files apart from Cargo extraction bookkeeping. It refuses to claim unmodified-source coverage if covered library code differs. If future changes patch/vendor a covered library, package its actual modified Source Code Form, preserve its notices, disclose how recipients obtain that source, and revise this workflow; an original upstream archive is not the corresponding source of locally modified code. Source archives and notices must remain accessible to recipients in installed resources or an accompanying distribution, not only in the developer repository.

## Remaining release verification

- Bundle this entire directory, including `sources/`, `upstream/`, `SOURCE-NOTICE.md`, the application license and reference notices. Verify installed file presence and readable source-notice discovery in the final application/installer. Tauri resource configuration and final installer inspection are outside this task's file ownership.
- Re-run offline freshness and Windows strict checks after any dependency/manifest change. The full all-target strict report is intentionally not green while the thirty other-target/optional gaps remain.
- Inspect actual installer payloads and any independently introduced DLL, font, image, model, SDK/runtime or native asset; package metadata alone is not a complete distribution inventory.
- Preserve original application and behavioral-reference attributions. No FreshRSS/Folo AGPL implementation or assets were copied. Publisher content rights remain separate.

## Sources

[1] https://www.mozilla.org/media/MPL/2.0/index.txt
[2] https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3650.58/microsoft.web.webview2.1.0.3650.58.nupkg
[3] https://raw.githubusercontent.com/wravery/webview2-rs/b74dc5e2b394044bea5191052868ce7a106c202c/crates/update-bindings/src/main.rs
