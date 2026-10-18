# Exercise the packaged Windows app in CI

## Problem and scope

The Windows workflow at `8834fbc` typechecks the renderer, runs browser fixtures
and Rust checks, and builds an NSIS installer. It uploads executable files without
inspecting their payload or launching the built native app. A green workflow can
therefore miss packaging mistakes and failures between the renderer and Rust.

This change adds the existing packaging regressions, installer inspection and
v0.5 native fixture to that job. It depends on the Windows setup change's offline
WebView2 configuration, inspector and `verify-release.test.py`. Its feature base
is setup commit `5c0855aa0ec00e11d3a5970f2d55af653fba22b2`, which already includes
the merged harness change. The main-only push trigger and offline setup
configuration remain intact.

## Gates and evidence

The job uses Python 3.12 and checks that the installed full `7z.exe` advertises NSIS
support. It records the runner image, tool details, WebView2 registration and
desktop session. Missing WebView2 fails with an explicit prerequisite error; the
workflow does not install or remove a runtime.

The three Python regression scripts cover package assembly, installer verification
and release-runner ordering. After the existing Tauri build, the inspector checks
the new offline installer using its normal payload allowlist, notice comparisons,
plugin hashes and Microsoft prerequisite signature check. CI copies its successful
report to a new `ci-` evidence filename, so an old committed payload report is not
presented as this run's result.

The native step passes the inspected packaged executable to
`v05-native-smoke.mjs`. That harness copies and hashes the executable, creates fresh
appdata and WebView storage, imports its six synthetic articles through the real
backup API, and checks the existing v0.5 interactions through real native IPC.
The named checks and their assertions are unchanged. It uses an ephemeral CDP
port and retains JSON, screenshots, executable and script hashes, and cleanup
results.

Packaging regressions have a five-minute step limit. Inspection and native smoke
each have ten minutes, with a separate two-minute cleanup step and a sixty-minute
job limit. An `always()` upload retains this run's `ci-` logs, native JSON and
screenshots, and generated NSIS script for fourteen days, including failed runs.
Executable artifacts are uploaded only after all gates succeed.

## Keep the fixture away from live feeds

The existing harness disables sources after launch. The Rust host starts a
scheduled refresh immediately, so a fresh database could contact seeded feeds
before that point. Its HTTP client ignores proxy environment variables.

The optional `--ci-offline` mode closes this gap before the copied app starts.
`ci-native-firewall.ps1` accepts only a GitHub-hosted Windows job and an executable
inside the harness's fresh directory under `RUNNER_TEMP`. It creates one outbound
block named for the workflow run and attempt, checks the active rule and exact
program filter, and then allows the harness to launch. It requires the firewall
service and enabled profiles that accept local rules. It fails before app launch
when these requirements are not met and does not change profile settings.

Normal harness cleanup runs in `finally`. The workflow's additional cleanup step
handles a native step timeout by stopping only a process whose executable path
matches the owned rule, then removing that rule. If the owned process remains
alive, cleanup leaves its outbound block in place and fails. A hard job cancellation
may prevent cleanup and artifact upload; GitHub disposes of the hosted job VM.
The option is rejected outside GitHub-hosted jobs. The default local harness
behavior and product code are unchanged.

## Windows PowerShell module compatibility

The job starts the inspector and native harness from PowerShell 7. Their Python
and Node processes then invoke Windows PowerShell 5.1. Microsoft documents that
these [intermediate processes can pass incompatible PowerShell 7 module paths][6]
to Windows PowerShell and break module autoloading. Both launchers remove every
case-insensitive `PSModulePath` key from the child environment, letting Windows
PowerShell rebuild its default paths. The parent environment is unchanged.

The Authenticode probe still receives the literal installer filename as environment
data and requires the existing valid Microsoft publisher signature. A failed
probe reports its exit code and the last 3,000 characters of each captured output
stream, while preserving the original exception and failing verification. The
native launcher retains its hosted-runner checks, exact owned executable rule,
timeouts and cleanup behavior.

The Windows regression prepends a fixture `Microsoft.PowerShell.Utility` module
requiring PowerShell 7 to the inherited module path, then calls the real signature
helper on Windows' signed `powershell.exe`. It requires a valid Microsoft signature
and an unchanged parent module path. It does not require PowerShell 7 to be installed.

## Runner assumptions and limits

GitHub's [runner reference][1] identifies `windows-latest` with Windows Server 2025
and documents administrator privileges with UAC disabled. Its current [image
manifest][2] lists full 7-Zip and Python, but does not establish WebView2 readiness
or a usable desktop for this application. The workflow checks the runtime and
the native harness must establish actual launch and interaction. Image updates,
firewall policy, certificate validation or desktop availability can fail those
gates; they are not converted into skips.

The rule uses Microsoft's documented [program-specific firewall controls][3] and
checks the [active profile configuration][4]. Its temporary path and hosted-only
guard use GitHub's [runner environment variables][5].

This job does not execute the setup program. It cannot prove missing-runtime
installation, offline setup, clean Windows 10/11 first launch, physical display
scaling, Windows notification delivery, live feed quality or local inference.
The larger daily native suite still covers detached windows and restart separately.

## Validation

On Linux after merging main at `cd24327` into the CI branch:

- `package-release.test.py`: 9 passed.
- `verify-installer.test.py`: 8 passed, 2 skipped (the real Windows Authenticode
  regression and the historical local installer fixture).
- `verify-release.test.py`: 3 passed.
- `node --check scripts/v05-native-smoke.mjs`: passed.
- The captured-output regression failed against the old signature helper and
  passed after the diagnostic change.
- Initial CI validation parsed the workflow as YAML and checked the main-only
  push trigger and offline setup configuration against the feature base.
- `git diff --check`: passed.

An isolated Windows probe confirmed the incompatible-module fixture's behavior
against a signed WebView2 runtime. The old helper failed with
`CouldNotAutoloadMatchingModule` for `ConvertTo-Json`; removing `PSModulePath` from
the child environment returned a valid Microsoft signature for the same file.
The committed Windows regression against `powershell.exe` also failed against the
old helper and passed after the fix. On Windows 11 x64 with Python 3.14, all 21
applicable packaging checks passed; only the historical local-installer fixture
was skipped. Node syntax, PowerShell parsing and Git whitespace checks passed.
PowerShell parsing did not execute any firewall action.

The Linux checks do not validate PowerShell or Windows Firewall execution. A
GitHub-hosted Windows run remains required to establish actual prerequisite
availability, extraction, signature checks, native interaction, the outbound
block and cleanup after both success and failure. No Windows firewall rule,
runtime installer or app was run on a user's machine while preparing this change.

[1]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
[2]: https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md
[3]: https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule
[4]: https://learn.microsoft.com/en-us/powershell/module/netsecurity/get-netfirewallprofile
[5]: https://docs.github.com/en/actions/reference/workflows-and-actions/variables
[6]: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.5#starting-windows-powershell-from-powershell-7
