# Installed application acceptance on disposable Windows CI

The installed-application gate executes the original inspected NSIS setup,
launches the installed News Terminal executable in place, closes it gracefully,
and runs the installed uninstaller. It covers a fresh application installation
with an existing WebView2 Runtime on the recorded GitHub-hosted Windows image.
This document describes the acceptance contract. The first successful hosted
run and its artifacts are needed before claiming that the contract passed.

## What the gate checks

The workflow builds the frontend and NSIS package, runs
scripts/verify-installer.py, and retains its extracted payload. The inspector
continues to be read-only. It now also records packaged_uninstaller_sha256,
so uninstall execution can be bound to the exact uninstaller inspected inside
the original setup.

scripts/ci-installed-smoke.mjs then performs these seven stages:

1. **Source and payload binding.** The original setup, standalone application,
   packaged application, and packaged uninstaller hashes must match the fresh
   inspection report. Current raw input hashes must match package-release.py's
   input map, including every new script and declaration. The report records
   helper and workflow hashes, the generated installer-script hash, Git head
   and tree, and the CI revision. The checkout must have no tracked changes.
   The workflow's successful build remains the evidence that these inputs were
   built; a hash map alone is not build provenance.
2. **Fresh disposable user state.** The gate refuses local and self-hosted
   execution, non-x64 processes, missing job identity, a different checkout,
   inherited application-data/CDP/WebView overrides, noninteractive sessions,
   missing WebView2, and preexisting News Terminal state. It checks relevant
   registry views, application data, normal installation paths, current and
   common shortcuts, autostart registration, and same-name processes. It also
   refuses reparse points in paths used by the installation.
3. **Installed payload and registration.** Setup runs silently into a fresh
   job-owned path containing spaces. Its complete installed file set and bytes
   must match the inspected application, uninstaller, and current notices.
   Add/Remove Programs metadata, manufacturer install location, and current-user
   Start menu and desktop shortcut targets must identify that installation.
4. **First-run defaults and usable UI.** The gate blocks the installed parent
   executable's outbound traffic before launch and starts that file directly.
   NEWS_TERMINAL_DATA_DIR is absent, so SQLite and window layout use the normal
   application-data location. It checks the real default profile and workspace,
   disabled AI providers without consent or credentials, disabled alerts and
   automatic images, and an empty fresh cache. It opens Preferences and writes
   a search query through the UI, then reads the persisted workspace through
   real IPC. There is no fixture import or mocked IPC.
5. **Graceful installed-app shutdown.** The shared native cleanup helper posts
   WM_CLOSE to the owned main window. The existing eight-second graceful
   deadline applies. The app must be alive when cleanup starts and exit normally
   with code 0, without a force attempt or close-request failure.
6. **Uninstall preserves application data.** The gate checks that no same-name
   process exists, then copies the exact inspected installed uninstaller bytes
   into its owned run container and executes them with NSIS's _?= option.
   Program files, Add/Remove Programs registration, and shortcuts must disappear.
   The complete default application-data file inventory must remain unchanged
   from its post-shutdown state: every relative file path, byte count, and SHA-256
   hash must match. The snapshot includes all present SQLite WAL/SHM sidecars,
   backups, and nested files; the main database and window-layout file remain
   required and nonempty. SQLite can commit transactions to the WAL before they
   reach the main file, so preserving the main file alone is insufficient.[sqlite-wal]
   The snapshot only reads file bytes and never opens or checkpoints SQLite.
   The manufacturer install-location preference must remain, matching the pinned
   silent-uninstall contract. WebView2 must still be registered.
7. **Final source binding.** Inputs, source revision, helper scripts, workflow,
   original setup, and extracted payload must still match the opening binding.

The final report is accepted only after owned-process and firewall cleanup
finishes. A failed stage, unexpected app exit, page or console error, forced
setup/uninstall/app cleanup, failed helper, or retained owned process keeps the
report and process exit status failed. Native stderr is retained separately for
review; it is not automatically treated as a fatal application error.

## Isolation and cleanup

The gate is restricted to a disposable GitHub-hosted Windows job.
It derives one run directory and one firewall-rule name from the run ID and
attempt. An ownership journal is written before setup and records the exact
application and command PIDs when they start. Fallback cleanup checks the
journal, exact executable path, and file hash before touching a process. The
workflow enables fallback cleanup only after this invocation records that it
created the fresh run directory and journal. A refused preflight cannot adopt
a preexisting journal. Cleanup never stops a process by name or removes WebView2.

Application-data snapshots use the existing Python prerequisite and the same
30-second JSON-helper limit. They check the root's ancestors before descending,
reject symbolic links and Windows reparse points before traversal, and accept
only ordinary directories and regular files. All regular files are hashed
recursively, including empty files; empty directories and filesystem metadata
are not preservation entries. The snapshot is taken after graceful app exit,
within the new application-data directory owned by this disposable job.

The pinned NSIS installer itself can silently stop a same-name current-user
process. This is why the guard checks for any news-terminal.exe before
installation and again before uninstallation, including processes outside the
chosen directory. A temporary /D= path alone would not isolate fixed
registration and shortcuts from an existing user installation.

Setup uses /S and a final, unquoted absolute /D= value, including spaces.
It does not use /R, /UPDATE, or /NS. For uninstall, _?= prevents NSIS's
usual temporary-copy relaunch, so the command being awaited performs the
uninstall. Running a copied, hash-checked uninstaller lets it delete the original
installed uninstaller without a post-test deletion hiding a failed uninstall.
These argument semantics come from the [NSIS command-line reference][nsis].

Setup and uninstall each have a 120-second deadline. Any force attempt fails
acceptance and retains its command result. Windows JSON helpers have a
30-second command limit. CDP attachment has a 45-second deadline. Individual
native IPC and asset CDP requests have 20-second deadlines, and state polling
bounds its awaited callback within the remaining poll budget. A timed-out
request rejects the stage before later UI actions; it does not cancel the
underlying browser request. Final cleanup closes the owned app and disconnects
CDP. The shared disconnect helper bounds its await at five seconds. That last
limit is not a hard process-exit deadline for Playwright's underlying WebSocket.

Normal uninstall preserves user data. The test does not choose the interactive
Delete app data checkbox. It leaves preserved data, the manufacturer preference,
and the owned run container in the disposable VM for evidence until the job is
discarded. An always-running workflow cleanup step separately handles an
interrupted harness's journaled processes and firewall rule. It does not claim
that a timed-out or incomplete uninstall succeeded. A partial failed setup may
leave program files or registration that cannot pass the normal uninstall
preconditions. Those failed-install remnants also remain until the VM is
discarded; fallback cleanup does not erase them to make the report pass.

## Evidence and remaining limits

The workflow uploads the ci-installed JSON, screenshots, logs, and ownership
journal with its other Windows evidence. The report includes the OS and image
version, session and user identity, administrator status, runtime registry
versions, all command results, observed native window/PID, embedded asset hashes,
first-run state, preserved-file hashes, and final cleanup. In
preservedApplicationData, files records the complete inventory before uninstall;
filesAfterUninstall records the inventory afterward, before comparison. A
missing, changed, or added file fails the stage and retains both completed
snapshots for review. The large source hash map remains in the original installer
report; the installed report records its digest and count.

This gate does not establish missing-WebView2 setup, a fully disconnected
machine, standard-user/UAC behavior, an interactive setup finish-page launch,
activation through the Start menu, upgrade/reinstall, consent to erase data,
Windows 10/11 coverage beyond the recorded OS image, ARM64, or 32-bit Windows.
CDP requires an explicit isolated WebView profile under the run container, so
only the application's ordinary SQLite/layout paths are covered. Frontend error
capture begins when CDP attaches. Screenshots show actual WebView content,
not Windows dialog chrome or physical DPI behavior.

GitHub documents that standard Windows jobs use a fresh VM, while their Windows
runners have administrator privileges and UAC disabled.[github] This makes the
runner useful for testing owned installation state without modifying a user's
computer. It does not replace a separate standard-user clean-image test.
Microsoft distinguishes elevated machine-wide runtime installation from
unelevated per-user installation; existing machine-wide Edge Update servicing
can also change runtime scope.[webview2]

The source configuration and generated-script checks preserve the pinned
Tauri CLI 2.11.5 current-user/offline-installer behavior. Its [installer
template][template] and [process/context helpers][utils] define registration,
shortcut handling, runtime detection, and the app-data checkbox. True
absent-runtime testing still requires a disposable image whose initial runtime
state is verified. No host runtime removal or registry spoofing is part of this
gate.

[nsis]: https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage
[github]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
[webview2]: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
[sqlite-wal]: https://sqlite.org/wal.html#the_wal_file
[template]: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
[utils]: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/utils.nsh
