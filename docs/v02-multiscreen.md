# v0.2 native monitor placement

## IPC contract

Both requests pass through the existing `dispatch` native handler. The caller is the actual Tauri `WebviewWindow`, never a renderer-supplied window label.

```ts
{ op: 'window_monitors' }
// => {
//   monitors: [{ id, name, x, y, width, height, scaleFactor, current }],
//   currentLabel: 'main' | 'detached-…'
// }

{ op: 'window_move', monitorId: string, layout: 'full' | 'left' | 'right' }
// => null on success, rejected IPC promise with an actionable string on failure
```

- Monitor geometry is the **physical work area**, excluding taskbars/docks, not logical screen dimensions. Signed x/y support monitors left of or above the primary.
- IDs hash the optional native display name and signed full-monitor origin. They do not contain an enumeration index. Changing origin invalidates the old ID deliberately. Size, DPI or taskbar changes are read afresh. An ID is a topology identity, not an EDID/hardware serial number.
- The destination is resolved from a fresh native enumeration for every move, then re-resolved after the initial placement. Missing and ambiguous IDs fail instead of selecting a different display. Enumeration may be empty; do not invent a fallback display in the UI.
- `current` is supplied by the native window's current-monitor query. `currentLabel` identifies the requesting window. The handler does not accept a target window label.
- Native calls use Tauri `available_monitors`, `current_monitor`, `Monitor::work_area`, signed `PhysicalPosition`, `PhysicalSize`, and measured outer/inner dimensions. No new dependency is required.

## Placement and persistence

1. Validate the requested layout and monitor; reject a definitely undersized target before moving.
2. Reject concurrent placement requests for the **same** window without holding a mutex across native dispatcher calls. Other windows remain independently movable.
3. Restore/unmaximize the caller, save its old restore bounds, and estimate destination frame metrics from the source and destination scale factors.
4. Move and resize in physical coordinates, then measure actual native decorations at the destination and correct the size/position. Tauri's size setter takes **inner** dimensions while the position is **outer**.
5. Require the complete outer frame to fit in the selected full/half work area and the inner dimensions to satisfy **640 × 480 logical pixels** at destination DPI. Odd-width displays give the right half the extra physical pixel. Small half-display layouts produce an explicit error, not an overflowing window.
6. Read native position, inner/outer size, and current monitor back before accepting the operation. Full placement additionally maximizes on the destination so the OS applies its exact work area. A failed placement attempts to restore the previous geometry; rollback failure is reported separately.
7. Persist the measured restore bounds and maximized flag without holding the layout mutex during any native dispatcher operation. Preserve profile/tab ownership. Existing movement/resize/scale-change events continue to save manually adjusted geometry.

The main window's old configured 800 × 600 minimum is overridden during native setup to match the detached window's 640 × 480 logical minimum. No config/package version change is necessary.

The existing `workspace-windows.json` format and backup remain compatible. Restart restoration selects a visible monitor, clamps the **outer frame** to its work area using its DPI/minimum, and restores maximized state. Existing detached labels, reconciliation, reattach, main-profile persistence and startup ownership validation remain in place. A monitor smaller than even the full-window minimum cannot satisfy both constraints and returns an error.

## Automated verification

Run from the repository root (Git Bash on Windows):

```sh
rustc --edition 2021 --test src-tauri/src/native_geometry.rs -o "$LOCALAPPDATA/Temp/news-native-geometry-tests.exe"
"$LOCALAPPDATA/Temp/news-native-geometry-tests.exe"
cargo test --manifest-path src-tauri/Cargo.toml --lib native
```

The standalone geometry tests need no Tauri runtime or display server. Coverage includes negative x/y, destination scale/minimum handling, physical decoration accounting, odd-width halves, full/split containment across 100–200% scales, unavailable-display restoration, corrupt saved sizes, invalid scales and unrepresentable coordinates. Native module unit tests cover stable identity, fresh-list resolution, ambiguous/disappeared IDs, per-window move exclusion, persisted geometry/ownership roundtrip and the existing orphan reconciliation regression.

New geometry/identity/resolution/exclusion behavior was introduced with observed failing tests followed by passing implementations. Serialization and broad containment tests additionally retain regression coverage.

Latest execution in this implementation pass: standalone geometry **8 passed**; Cargo native filter **13 passed**; `rustfmt --check` for the two native modules passed. The full Cargo run passed the library suite (50 passed, 4 ignored) but stopped at the unrelated backend test `provider_configuration_never_persists_keys_and_catalog_is_real`: `Cannot export restorable backup: Unknown or secret field in backup`. It also reported an unused guard warning in `tests/live/unit.rs:177`. Those files are owned by parallel workstreams and were not changed here; the full repository suite is **not certified green** by this task.

## Real-native acceptance — still required

**Unit tests and compilation do not prove actual multi-monitor or WM_DPICHANGED behavior. This implementation task did not launch the executable or change Windows display settings.** The parent/release native smoke pass must exercise the real packaged or debug executable with isolated application data, not browser fixtures:

- Enumerate real monitors and compare physical work areas and scales to the OS.
- Main and detached callers: full → left → right on each available display; move from maximized/minimized states. Verify the *other* window did not move and ownership did not change.
- Negative-coordinate/above-primary monitors and two physically different DPI scales; compare actual outer bounds, including decorations. Browser zoom/CDP emulation is not evidence for this case.
- Reject a split too small for 640 × 480 logical pixels; confirm no final overflow and rollback to prior placement.
- Reorder/hot-unplug displays between enumeration and move; expect stale-ID errors, never index-based moves. Verify refresh recovery. Hardware unplug after a successful final check remains an OS event, not an atomic display-topology transaction.
- Close/relaunch with main + detached windows in different layouts; verify normal restore bounds, maximized state, main profile and detached profile/tab ownership. Relaunch with a saved monitor disconnected.
- Reattach and import/remove an owning profile/tab; obsolete detached windows must close and not reappear on restart.
- Record actual native results separately from the pure/unit suites. Do not claim physical mixed-DPI coverage on a single-monitor machine.

## API references

Context7 was consulted before implementation against the official Tauri Rust documentation. Relevant APIs:

- https://docs.rs/tauri/latest/tauri/window/struct.Monitor.html
- https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html
- https://docs.rs/tauri/latest/tauri/window/struct.Window.html
