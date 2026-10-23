# Audit fixes implementation plan

> **For agentic workers:** Use test-first changes and independent code review before committing.

**Goal:** Resolve the twelve findings from the October 23 audit with focused fixes and regression checks.

**Architecture:** Keep the existing React/IPC/Rust/SQLite boundaries. Reuse replacement tokens, source-policy gates, existing ranking semantics and validation; avoid new application layers.

**Tech stack:** React, TypeScript, Tauri, Rust and SQLite.

**Spec:** The twelve numbered findings in this chat and the existing IPC contract.

## Constraints and review focus

- Preserve legacy backups, histories, credentials, source permissions and atomic replacement.
- Reject stale settings before any database or credential write; reset dirty forms after replacement.
- Keep saved stories and newer reader selections intact during bulk actions.
- Keep permission revocation effective before provider polling and final delivery.
- Limit allocation and input processing when increasing backup capacity.
- Prevent multiple hosts for one database while allowing independent data directories.
- Keep explicit tiling validation strict while making startup placement recoverable.

## Tasks

- [x] Frontend: reproduce stale settings and selected bulk-hide failures, fix them, and run browser regressions.
- [x] Database: reproduce instance ownership, backup capacity, shared saves and redundant migration writes; fix and run targeted Rust tests.
- [x] Feed/ranking: reproduce negation and skewed-tail work failures; preserve ranking parity and hoist feed-wide rights scanning.
- [x] Host: reject stale settings under the database lock and replace repeated sector scans with mutation-generation checks.
- [x] Native: add startup fallback coverage for small high-DPI work areas.
- [x] Dependencies: update the two affected development tools and regenerate their lockfile.
- [x] Run full Rust, frontend, browser, build, catalog, packaging and applicable notice checks; review the complete diff.
- Integration: commit, push the dedicated branch, create the pull request and attach it to this chat.

## Verification

Use disposable data and a dedicated browser output directory. Use the D: build/temp directories and one Rust compiler job to avoid the disk and paging limits seen during the audit. Record any native acceptance checks that cannot run.

313 runnable Rust tests passed across the full run and the targeted corruption-fixture correction; 19 environment-dependent Rust tests remain ignored. Frontend unit tests passed (110 passed, one platform skip), along with the production build, all 267 browser checks across the full run and one isolated keyboard-budget retry, catalog/packaging/release Python tests (35 passed, one tool-dependent skip), five license tests, regenerated license bundle with zero applicable Windows evidence gaps, and zero npm audit vulnerabilities. Rust formatting and Clippy across all targets passed with warnings denied. The rebuilt native executable passed all ten Windows/WebView2 smoke checks with no page or console errors and graceful owned-process cleanup. Independent code and security reviews found no actionable issues.

Native file-picker interaction, physical monitor/DPI behavior, installation/uninstallation, and the ignored live network/model/keyring checks remain outside this local run. Large file restores require temporary disk space proportional to the selected backup.
