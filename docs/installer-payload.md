# Windows installer payload review

## v0.2 release-tooling preparation — not a built release

The packaging/inspection tools now obtain the version from the root npm manifest,
lockfile root entries, Cargo manifest/lock root entry, and Tauri configuration.
All six values must match an exact SemVer string. No v0.2 installer or portable
archive was built or published by this tooling work. The evidence and download
files from v0.1 remain historical until the release owner runs fresh gates.

### Release-owner sequence

Finish **all** application, script, documentation, configuration and notice edits
before starting the root checks. In particular, after changing the root versions
(including both npm lockfile root versions and the root Cargo lock entry), run:

```bash
python scripts/license-notices.py --strict-windows
python scripts/license-notices.py --check --strict-windows
python scripts/license-notices.test.py
python scripts/package-release.test.py
python scripts/verify-installer.test.py
# The following is the parent's real build/test gate, not run by this preparation:
python scripts/verify-release.py
python scripts/verify-installer.py --sevenzip 'C:/Users/user/AppData/Local/Temp/nt-installer-review/7zip/7z.exe'
# Use extraction_dir from docs/evidence/installer-payload.json:
node scripts/native-smoke.mjs '<extraction_dir>/installer/news-terminal.exe'
python scripts/package-release.py --check-only
# Only after every preceding command succeeds:
python scripts/package-release.py
```

`verify-installer.py` checks both NSIS layers, the complete file allowlist (not
just executable-name heuristics), every packaged notice including the top-level
third-party index, and the standalone-versus-packaged executable. Only an exact
three-byte `UNK` -> `NSS` Tauri bundle-marker change is allowed; all other bytes
must match. It records the version, both application hashes, installer hash and
SHA-256 map of current source/config/test/tooling/documentation/notice inputs.
It leaves the extracted binary available for the separate native smoke test and
replaces payload evidence only after a successful inspection.

`package-release.py` requires all eleven named root gates, zero exit codes,
logs timestamped within that root run, sources/notices predating its start,
and build artifacts timestamped within the run. Current installer/standalone
hashes and the full input map must match payload verification. The passed native
smoke report must identify the current extracted application's hash and must
postdate that executable and installer. Changes after the gates require rerunning
the gates; a previous `passed: true` alone is insufficient. `--check-only` makes
no distribution writes. These are local consistency/freshness checks, not signed
build attestations or a substitute for reviewing the real command logs.

For version `0.2.0`, final assembly writes immutable
`News-Terminal-0.2.0-windows-x64-setup.exe`,
`News-Terminal-0.2.0-windows-x64-portable.zip`, `SHA256SUMS-0.2.0.txt`, and
`artifacts-0.2.0.json`. Any existing same-version output blocks replacement.
Before generic `SHA256SUMS.txt` / `artifacts.json` pointers may change, their prior
artifact hashes/checksums are checked and their **exact bytes** are archived as
`SHA256SUMS-<old-version>.txt` / `artifacts-<old-version>.json`. Existing v0.1
binaries/ZIPs are never rewritten. ZIP assembly and integrity/byte comparisons
happen in a temporary staging directory, followed by another freshness check.
Promotion uses exclusive creation for versioned files and per-file atomic replace
for generic pointers. **The multi-file promotion is not a single atomic
transaction:** interrupted promotion may leave partial new-version files or
mismatched generic pointers. Preserve prior archives; inspect/remove only failed
new-version outputs or restore generic pointers from the matching immutable
metadata pair before retrying. Never blindly delete or overwrite an old release.

The portable ZIP is a convenience app/notices bundle, not a local-AI deployment.
It contains no repository helper scripts, `.local-ai`, Ollama runtime, models,
Python or downloaded toolchain. A dedicated portable README explains that
repository setup commands do not work from that ZIP. The repository-local
loopback AI setup at `127.0.0.1:11434` remains separate; see `docs/local-ai.md`.
The Tauri resource allowlist is unchanged. Runtime/model-shaped payload names are
also explicitly rejected, including weights accidentally placed under notices.

Tests stage synthetic fixtures only in temporary directories. Where the retained
v0.1 installer and official full 7-Zip are available, an integration test also
extracts both **real historical** archive layers in an isolated fixture; that is
not evidence that a v0.2 application was built or passed its native checks.

## Historical v0.1 parent verification

The resource mapping was added and the installer rebuilt. `scripts/verify-installer.py --sevenzip <path-to-full-7z.exe>` passes against the final installer: all 383 dependency-notice files and 11 installer-notice files match byte-for-byte; both archive layers use Deflate and all expected plugins match. The packaged application was extracted and passed the complete native smoke suite without installing the application or modifying installer registry entries. Its three-byte `UNK` -> `NSS` bundle-type marker differs from the standalone build as expected, so the packaged executable was tested separately rather than assuming identical hashes. Exact final hashes and extraction evidence are in `docs/evidence/installer-payload.json`; download checksums are in `release/SHA256SUMS.txt`.

The earlier missing-packaged-notices gate below is resolved. The upstream prebuilt-plugin transitive-version provenance limitation remains documented; this is not blanket legal-compliance certification.

## Historical review details

## Scope and release gate

This review supplements `resources/licenses/**`; it does not modify or replace
that Cargo/npm inventory. It covers the actual cached NSIS inputs and the
installer/uninstaller payload. No installer was executed, no application was
installed, and no registry changes were performed.

The requested release configuration is NSIS **zlib** compression and
`bundle.windows.webviewInstallMode.type = "skip"` (user-provided WebView2).
At first inspection, `src-tauri/tauri.conf.json` had those values, but the
existing generated script and EXE were stale (`lzma`/`downloadBootstrapper`).
During the review the parent regenerated them. The actual release EXE with
SHA-256 `717db87bb887d1c8760fd47b8df1862f3b8b3e3cdc2029ad87d88348e2014996`
(6,660,779 bytes) was then extracted and verified: both compression layers are
Deflate, the regenerated script selects zlib/empty WebView2 mode, and all
installer/uninstaller DLL names and bytes match the table and toolchain hashes
below. **That reviewed EXE contained none of the newly created
`installer-notices/` files. Rebuild with the installer-notices resource mapping,
then repeat final-artifact checks before distribution.** This is a delivery
gate, not an unresolved identification of the selected plug-ins.

To test the selected configuration without overwriting the parent's build, a
diagnostic copy of the exact generated script was compiled in a temporary
directory with only `"lzma"` changed to `"zlib"` and the
`INSTALLWEBVIEW2MODE` define changed from `"downloadBootstrapper"` to `""`.
The empty string is how this Tauri bundler represents skip, not the literal
string `"skip"`.[1] The diagnostic compile succeeded (makensis exit 0), both
installer and nested uninstaller extracted successfully, and both reported
`Method = Deflate`, `Solid = +`, `NSIS-3 Unicode`.

This diagnostic did not include the newly created notices. It establishes the
selected engine/plug-in payload, not final notice-delivery verification. Its
script and EXE hashes are preserved in
`resources/installer-notices/diagnostic-payload-evidence.json`.

## Actual toolchain and upstream identity

- Installed npm package `@tauri-apps/cli`: **2.11.5** (local package.json).
- Cached `C:/Users/user/AppData/Local/tauri/NSIS/makensis.exe -VERSION`:
  **v3.11**.
- Tauri CLI 2.11.5's bundler pins the NSIS 3.11 archive and
  nsis-tauri-utils **0.5.3**, with SHA-1 checksums.[1]
- Fresh downloads of both pinned assets matched those checksums. The cached
  compiler launcher, selected zlib stub, standard plug-ins, UI resources and
  COPYING were byte-compared against the downloaded NSIS archive.[2]
- The cached `nsis_tauri_utils.dll` matched the release asset byte-for-byte;
  release tag `nsis_tauri_utils-v0.5.3` points at
  `13d9edd27b69310e108d6fbd49f90992f8a05390`.[3][4]

| Artifact | SHA-256 |
| --- | --- |
| NSIS archive | `c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1` |
| nsis_tauri_utils.dll | `5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709` |
| Selected `zlib_solid-x86-unicode` stub | `e6c2afdd03c7bc5f1dc24449e5c92f3859f7586f399dff01c175d52e052bc943` |

Further hashes, authentic notice origins and comparisons are in
`resources/installer-notices/provenance.json`. These are artifact identities,
not a reproducible-build attestation.

## Exact plug-in payload: inspect the uninstaller too

The diagnostic build and regenerated release EXE contained **five unique plug-ins**
across both executables. Every extracted DLL matched its cached toolchain file
byte-for-byte. An x64 application uses the x86-Unicode NSIS engine/plug-ins in
this build; that is not an x64 plug-in directory.

| Plug-in | Installer | Nested uninstaller | Role/evidence | Notice |
| --- | --- | --- | --- | --- |
| `System.dll` | Yes | Yes | Windows/COM calls in installer.nsi and utils.nsh | NSIS COPYING |
| `nsDialogs.dll` | Yes | No | Modern UI and reinstall page controls | NSIS COPYING |
| `StartMenu.dll` | Yes | No | MUI start-menu page macros, even with page skipped at runtime | NSIS COPYING |
| `LangDLL.dll` | No | Yes | Language DLL retained in nested uninstaller; missed by outer-only listing | NSIS COPYING |
| `nsis_tauri_utils.dll` | Yes | Yes | SemverCompare, RunAsUser, process and string helpers | Upstream 0.5.3 MIT / Apache texts |

**Not present in this diagnostic configuration:** `NSISdl.dll`, `nsExec.dll`,
other cached stock NSIS plug-ins, WebView2 setup/runtime executables, or a
VC redistributable installer. `NSISdl.dll` was present in the stale
`downloadBootstrapper` build; searching unpreprocessed template text alone
would falsely retain it for skip mode. No VC runtime redistribution mechanism
was found in the generated file-copy list. This is a payload statement, not a
claim that the executable has no operating-system/runtime imports or embedded
compiler runtime code.

Other installer inputs:

- `modern-wizard.bmp` is byte-identical to NSIS
  `Contrib/Graphics/Wizard/win.bmp` (SHA-256
  `3ad2dc318056d0a2024af1804ea741146cfc18cc404649a44610cbf8b2056cf2`).
- Modern UI 2 defaults to `Contrib/UIs/modern.exe` via `ChangeUI`; its dialogs
  become installer resources, not a separately installed executable.
- The extracted `news-terminal.exe` matched the existing release application
  binary. Application notices/source archives remain the separate
  `resources/licenses` responsibility.

## Authentic notices supplied

The entire NSIS COPYING is copied without edits from the verified archive.
It licenses NSIS generally and its zlib module under zlib/libpng terms, while
also retaining the archive's bzip2 and LZMA/CPL sections. Keeping the original
notice intact does not mean those unused decompressors are shipped.[2]

Modern UI 2's **actual packaged** `Docs/Modern UI 2/License.txt` is also copied
byte-for-byte, including its original Windows text encoding. Its final clause
says the notice may not be removed or altered from any distribution; COPYING
alone should not stand in for this specific notice.[2] An additional Modern UI
notice from the NSIS 3.11 source commit is retained separately.[6][8]

The 0.5.3 plugin's MIT copyright notice and Apache-2.0 license are copied from
the pinned commit, with its original Cargo manifests for provenance. The
workspace declares an alternative MIT or Apache-2.0 license; preserving both
does not assert that both must be selected.[4] The Tauri template/helper MIT
notice is also preserved from the CLI tag.[7]

## Genuine remaining unknowns

1. **Final delivery must be verified after rebuild.** The diagnostic is not the
   release EXE. The resource map must include
   `"../resources/installer-notices/": "installer-notices/"`, then extracted
   notice bytes must match every source notice file.
2. **Prebuilt plugin dependency closure.** The upstream source tree has no
   Cargo.lock and the release exposes the DLL rather than a resolved build
   SBOM. Its Cargo manifests declare `semver = "1.0"`, `windows-sys = "0.61.2"`
   and local `nsis-plugin-api`; these are requirements, not authenticated
   resolved binary dependency versions.[3][4] Hash equality identifies the
   release asset but cannot establish its exact statically linked dependency
   notices or compiler-runtime content. Obtain upstream build lock/SBOM data,
   or rebuild under a pinned, inventoried toolchain to close this gap. Do not
   substitute this app's Cargo.lock for the plugin's missing build lock.
3. This records provenance and notices, **not blanket legal compliance**.
   Changing installer mode, plug-ins, NSIS/CLI version, compression, runtime
   installation mode or custom template invalidates the payload conclusions.

## Reproduction and final-artifact checks

The inspection tool was obtained from the official 7-Zip download links.[5]
`7zr.exe` extracted the official x64 7-Zip installer archive; that installer
was never run. The standalone extracted tool is:

`C:/Users/user/AppData/Local/Temp/nt-installer-review/7zip/7z.exe`

This is an inspection-only temporary tool, not a News Terminal resource.
It reports 7-Zip 26.03. Acquisition hashes and logs are in the same temporary
review directory. Use an equivalent official full 7-Zip build on another host
(the reduced 7zr/7za builds do not replace the full NSIS archive reader).

From Git Bash, after the parent finishes the real Tauri rebuild:

```bash
SEVEN='C:/Users/user/AppData/Local/Temp/nt-installer-review/7zip/7z.exe'
EXE='C:/Users/user/Documents/News Terminal/src-tauri/target/release/bundle/nsis/News Terminal_0.1.0_x64-setup.exe'
OUT='C:/Users/user/AppData/Local/Temp/nt-installer-final-review'
"$SEVEN" l -slt "$EXE"
"$SEVEN" x "$EXE" "-o$OUT" -y
"$SEVEN" l -slt "$OUT/uninstall.exe"
"$SEVEN" x "$OUT/uninstall.exe" "-o$OUT/uninstaller-payload" -y
```

Check the regenerated `installer.nsi`, not just tauri.conf.json:

- `SetCompressor /SOLID "zlib"` and `!define INSTALLWEBVIEW2MODE ""`.
- No nonempty bootstrapper/offline-installer paths; no custom external-binary
  or VC redistributable File entry.
- Every `resources/installer-notices` source mapped to an installed
  `installer-notices` file; compare **bytes**, not only names/counts.
- Both archives report Deflate. Outer plugin names equal the four installer
  names in the table; nested names equal its three uninstaller names. Compare
  DLL hashes against provenance.json, including LangDLL.
- No runtime/bootstrapper redistributable and no NSISdl DLL in either layer.
- Record the final EXE SHA-256 and byte-comparison result in release evidence;
  only then mark the first remaining item closed.

For the diagnostic already executed, reproducible temporary scripts/logs are
`fetch.py`, `review_build.py`, `review-compile.log`, `review-list.txt`,
`review-extract.log`, `review-extracted/`, and `uninstall-extracted/` beneath
`C:/Users/user/AppData/Local/Temp/nt-installer-review/`. Its original generated
script hash is preserved in the diagnostic evidence JSON. The diagnostic
script deliberately refuses an input that no longer has the old settings;
use the final-artifact procedure after regeneration instead of rerunning it.

## Sources

[1] https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs
[2] https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip
[3] https://github.com/tauri-apps/nsis-tauri-utils/releases/tag/nsis_tauri_utils-v0.5.3
[4] https://github.com/tauri-apps/nsis-tauri-utils/tree/13d9edd27b69310e108d6fbd49f90992f8a05390
[5] https://www.7-zip.org/download.html
[6] https://raw.githubusercontent.com/kichik/nsis/7359413009afd4f0fff472d841fc2f2cc0e0a5f8/Contrib/Modern%20UI/License.txt
[7] https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.11.5/LICENSE_MIT
[8] https://github.com/kichik/nsis/tree/7359413009afd4f0fff472d841fc2f2cc0e0a5f8
