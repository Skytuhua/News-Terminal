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

On Linux after rebasing onto the setup feature base:

- `package-release.test.py`: 9 passed.
- `verify-installer.test.py`: 7 passed, 1 historical Windows artifact test skipped.
- `verify-release.test.py`: 3 passed.
- `node --check scripts/v05-native-smoke.mjs`: passed.
- The updated workflow parsed as YAML; the main-only push trigger and offline
  setup configuration were checked against the feature base.
- `git diff --check`: passed.

These checks do not validate PowerShell or Windows Firewall execution. A
GitHub-hosted Windows run remains required to establish actual prerequisite
availability, extraction, signature checks, native interaction, the outbound
block and cleanup after both success and failure. No Windows firewall rule,
runtime installer or app was run on a user's machine while preparing this change.

[1]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
[2]: https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md
[3]: https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule
[4]: https://learn.microsoft.com/en-us/powershell/module/netsecurity/get-netfirewallprofile
[5]: https://docs.github.com/en/actions/reference/workflows-and-actions/variables
