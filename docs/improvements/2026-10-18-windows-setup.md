# Windows setup prerequisite handling

## Scope and plan

The previous `skip` configuration left a first-run failure when a Windows user
did not already have WebView2. This change keeps the x64 NSIS package, uses
Tauri's bundled offline runtime installer, and makes the release inspection
prove that the expected prerequisite is present.

1. Confirm the installed Tauri versions and their installer semantics.
2. Select `offlineInstaller`, `silent: true` and `currentUser`.
3. Update payload verification, portable guidance and Microsoft attribution.
4. Test rejection of stale, missing or changed payloads and release gate failures.
5. Hand off the frozen patch for native Windows build and independent review.

## Implementation

The npm lockfile pins Tauri CLI 2.11.5. Cargo locks Tauri 2.11.6, tauri-build 2.6.3
and tauri-utils 2.9.3. The reviewed [2.11.5 NSIS template][1] checks the machine
and user runtime registrations, waits for the runtime installer, and aborts on
failure. Current-user mode requests user privileges. The [bundler][2] selects
the offline package and supplies `/silent`. No dependency versions changed.

The verifier now checks the generated configuration and exact runtime member,
compares runtime bytes, and obtains Windows Authenticode status without running
the runtime installer. Filenames pass to PowerShell through a child-only
environment variable, so paths with spaces or shell syntax remain data. A
Microsoft component notice is required alongside the existing notices.

Release evidence includes the actual runtime hash, size and signing certificate.
The packager rejects old evidence, invalid signatures and changed extracted
runtime bytes before creating release output. The gate runner now performs
payload inspection between the build and the native smoke test, and smoke uses
the inspected packaged executable. `verify-release.py` therefore requires an
explicit `--sevenzip` path.

The portable ZIP contains no prerequisite installer. Its instructions explain
the existing-runtime requirement and link to Microsoft. Source access,
zero-paid provider enforcement, local storage and AI consent behavior are
unchanged. Microsoft's Evergreen runtime servicing remains separate from those
application settings.[3]

## Verification

The following focused suites ran with Python 3.12.14 and use temporary synthetic
fixtures. They do not install software or produce release evidence:

- `python scripts/package-release.test.py`: 9 tests passed.
- `python scripts/verify-installer.test.py`: 7 tests passed; 1 historical
  installer/7-Zip extraction fixture skipped because its local artifacts are
  unavailable in the implementation mirror.
- `python scripts/verify-release.test.py`: 3 tests passed.

Negative cases cover stale skip/online/elevated settings, duplicate generated
defines, missing or changed runtime bytes, an extra bootstrapper, a missing
Microsoft notice, a runtime in the uninstaller, invalid signatures, missing
release gates, and inspection failure before native launch. Existing local-AI
payload exclusions and immutable release-output tests still pass.

## Limits and handoff

The implementation and Python tests ran against an exact local mirror after the
Windows connector stalled. The root worker applies the patch to the isolated
Windows worktree, reruns verification there, and owns the native build slot.
No installer, runtime removal, user-data change, dependency install, push, merge
or release was performed by this work.

Windows Authenticode inspection, full extraction of the new offline installer,
and a native launch still require the Windows build. A clean-machine install
matrix is a separate release-owner task described in
`docs/installer-payload.md`. Windows 10/11 x64 is the target, with no claim that
all Windows devices, native ARM64 or 32-bit systems were tested. The offline
installer grows the download and allows prerequisite setup without internet;
it does not make live feeds available offline. Evergreen contents can change,
and the release evidence records the actual included bytes.[3]

[1]: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
[2]: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs
[3]: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
