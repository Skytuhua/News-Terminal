# PR stack review

Review of the six stacked pull requests, with fixes tested on the combined tree.
The repository version remains 0.4.0; this review does not publish a release.

| PR | Review outcome |
| --- | --- |
| [#1](https://github.com/Skytuhua/News-Terminal/pull/1) | Atomic batch state writes and profile-scoped receipts are covered by the backend suite. Clarified that replacement-token validation follows top-level profile parsing. |
| [#2](https://github.com/Skytuhua/News-Terminal/pull/2) | Failed source previews stop showing a loading message. The native sector runner opens the lazy preview before waiting for generation. |
| [#3](https://github.com/Skytuhua/News-Terminal/pull/3) | No blocking issue found in the density change. The combined browser suite exercises compact widths and zoom. |
| [#4](https://github.com/Skytuhua/News-Terminal/pull/4) | Read-empty briefing copy explains the filter and clears it without leaving the brief. Focused navigation controls describe unread counts. Hidden stories omits its badge because the snapshot cannot count its full retained collection. |
| [#5](https://github.com/Skytuhua/News-Terminal/pull/5) | Receipt dates use host Unix seconds; history errors offer retry and long lists scroll. Alert history cannot mutate invisible stories through shortcuts. Bulk acknowledgements preserve selections in a newer scope. Read toggles use confirmed state, and X shares Hide's acknowledgement and Undo handling. Retention text and browser fixtures match the host. |
| [#6](https://github.com/Skytuhua/News-Terminal/pull/6) | Debugging remains opt-in. Native waits check the actual rendered width and confirmed read transition. Native page errors fail the runner. Future evidence hashes the runner and a verified executable copy. Historical artifacts remain unchanged. |

The synthetic performance probe now fingerprints sources before building, rejects
changes during the run, and waits for the clicked story's exact title. It supports
an explicit `--browser-executable` for machines with system Chromium.

## Local validation

- Frontend production build and TypeScript check passed.
- 37 frontend unit tests passed.
- 237 browser fixture tests passed, including regression coverage for the fixes.
- 159 headless Rust tests passed; six optional tests were explicitly ignored.
- Rust formatting passed.
- 10 Python catalog tests passed; the 69-source validator reported no errors.
- Five synthetic browser performance trials completed with zero browser errors
  and no source changes during measurement.

The headless Rust helper imports unchanged production modules and existing
integration tests outside the checkout. It does not compile the native Tauri
entry point. Browser fixtures do not establish Windows/WebView2 behavior.
Fresh Windows CI must pass for the final revision before integration. Current
native acceptance requires rebuilding and running the Windows smoke scripts;
see [native evidence limits](v05-native-acceptance.md).
