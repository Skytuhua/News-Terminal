use crate::native_geometry::{
    restore_bounds, tile_bounds, visible_bounds, Frame, Rect, TileLayout,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Placement {
    profile_id: String,
    tab_id: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}
impl Placement {
    fn bounds(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}
#[derive(Default, Serialize, Deserialize)]
struct Layout {
    windows: BTreeMap<String, Placement>,
    main: Option<Placement>,
}
struct NativeState {
    layout: Mutex<Layout>,
    moving: Mutex<BTreeSet<String>>,
    path: PathBuf,
    exiting: AtomicBool,
}

struct MoveGuard<'a> {
    active: &'a Mutex<BTreeSet<String>>,
    label: String,
}
impl Drop for MoveGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.label);
        }
    }
}
fn begin_move<'a>(
    active: &'a Mutex<BTreeSet<String>>,
    label: &str,
) -> Result<MoveGuard<'a>, String> {
    if !active
        .lock()
        .map_err(|_| "Window movement state is unavailable")?
        .insert(label.into())
    {
        return Err("This window is already being moved. Retry when placement completes.".into());
    }
    Ok(MoveGuard {
        active,
        label: label.into(),
    })
}

fn reconcile_layout(
    layout: &mut Layout,
    valid: impl Fn(&str, Option<&str>) -> Result<bool, String>,
) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    for (label, placement) in &layout.windows {
        if !valid(&placement.profile_id, Some(&placement.tab_id))? {
            removed.push(label.clone());
        }
    }
    if let Some(main) = &mut layout.main {
        if !valid(&main.profile_id, None)? {
            main.profile_id = "default".into();
            main.tab_id.clear();
        }
    }
    for label in &removed {
        layout.windows.remove(label);
    }
    Ok(removed)
}

fn save(state: &NativeState, layout: &Layout) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(layout).map_err(|_| "Could not serialize window layout")?;
    let temporary = state.path.with_extension("tmp");
    fs::write(&temporary, &bytes)
        .map_err(|_| "Could not save window layout. Check available disk space.")?;
    // Keep last valid layout recoverable if an interrupted replacement leaves no current file.
    if state.path.exists() {
        fs::copy(&state.path, state.path.with_extension("bak"))
            .map_err(|_| "Could not back up window layout")?;
    }
    fs::rename(&temporary, &state.path).map_err(|_| "Could not replace window layout".to_string())
}

fn monitor_identity(name: Option<&str>, x: i32, y: i32) -> String {
    // Names plus signed physical origins survive enumeration reordering. A changed
    // topology intentionally invalidates old IDs instead of selecting another index.
    let bytes = serde_json::to_vec(&(name, x, y)).expect("monitor identity is serializable");
    format!("monitor-{:x}", Sha256::digest(bytes))
}

fn unique_monitor_index(ids: &[String], requested: &str) -> Result<usize, String> {
    let mut matches = ids
        .iter()
        .enumerate()
        .filter(|(_, id)| id.as_str() == requested);
    let (index, _) = matches
        .next()
        .ok_or("Selected monitor is no longer available. Refresh the monitor list.")?;
    if matches.next().is_some() {
        return Err(
            "Selected monitor identity is ambiguous. Change the display topology and refresh."
                .into(),
        );
    }
    Ok(index)
}

fn monitor_id(monitor: &tauri::Monitor) -> String {
    monitor_identity(
        monitor.name().map(String::as_str),
        monitor.position().x,
        monitor.position().y,
    )
}

fn work_area(monitor: &tauri::Monitor) -> Rect {
    let area = monitor.work_area();
    Rect {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    }
}

fn default_main_rect(work: Rect, scale: f64, size: Option<(u32, u32)>) -> Result<Rect, String> {
    if !scale.is_finite() || scale <= 0.0 || work.width == 0 || work.height == 0 {
        return Err("Monitor geometry is invalid".into());
    }
    let minimum_width = (640.0 * scale).ceil() as u32;
    let minimum_height = (480.0 * scale).ceil() as u32;
    let preferred_width = size
        .map(|s| s.0)
        .unwrap_or_else(|| (1440.0 * scale).ceil().max(minimum_width as f64) as u32);
    let preferred_height = size
        .map(|s| s.1)
        .unwrap_or_else(|| (900.0 * scale).ceil().max(minimum_height as f64) as u32);
    let width = preferred_width.clamp(minimum_width.min(work.width), work.width);
    let height = preferred_height.clamp(minimum_height.min(work.height), work.height);
    Ok(Rect {
        x: work.x + ((work.width - width) / 2) as i32,
        y: work.y + ((work.height - height) / 2) as i32,
        width,
        height,
    })
}

fn initial_main_rect(
    position: Option<(i32, i32)>,
    size: Option<(u32, u32)>,
    monitor: Option<(Rect, f64)>,
) -> Result<Rect, String> {
    if let Some((x, y)) = position {
        return Ok(Rect {
            x,
            y,
            width: size.map(|s| s.0).unwrap_or(1440),
            height: size.map(|s| s.1).unwrap_or(900),
        });
    }
    if let Some((work, scale)) = monitor {
        return default_main_rect(work, scale, size);
    }
    Ok(Rect {
        x: 0,
        y: 0,
        width: size.map(|s| s.0).unwrap_or(1440),
        height: size.map(|s| s.1).unwrap_or(900),
    })
}

fn monitors(window: &WebviewWindow) -> Result<Value, String> {
    let current = window
        .current_monitor()
        .map_err(|_| "Could not read the current monitor")?
        .as_ref()
        .map(monitor_id);
    let available = window
        .available_monitors()
        .map_err(|_| "Could not enumerate monitors")?;
    let values: Vec<_> = available.iter().map(|monitor| {
        let id = monitor_id(monitor);
        let area = work_area(monitor);
        json!({ "id": id, "name": monitor.name().map(String::as_str).unwrap_or("Unnamed display"),
            "x": area.x, "y": area.y, "width": area.width, "height": area.height,
            "scaleFactor": monitor.scale_factor(), "current": current.as_ref() == Some(&id) })
    }).collect();
    Ok(json!({ "monitors": values, "currentLabel": window.label() }))
}

fn resolve_monitor(window: &WebviewWindow, id: &str) -> Result<tauri::Monitor, String> {
    let available = window
        .available_monitors()
        .map_err(|_| "Could not enumerate monitors")?;
    let ids = available.iter().map(monitor_id).collect::<Vec<_>>();
    Ok(available[unique_monitor_index(&ids, id)?].clone())
}

fn frame(window: &WebviewWindow) -> Result<Frame, String> {
    let outer = window
        .outer_size()
        .map_err(|_| "Could not read window frame")?;
    let inner = window
        .inner_size()
        .map_err(|_| "Could not read window size")?;
    Ok(Frame {
        width: outer.width.saturating_sub(inner.width),
        height: outer.height.saturating_sub(inner.height),
    })
}

fn apply_rect(window: &WebviewWindow, rect: Rect) -> Result<(), String> {
    // Moving first lets the native host apply destination DPI. Reapply the outer
    // origin after sizing because WM_DPICHANGED can suggest a different position.
    window
        .set_position(PhysicalPosition::new(rect.x, rect.y))
        .map_err(|_| "Could not move window")?;
    window
        .set_size(PhysicalSize::new(rect.width, rect.height))
        .map_err(|_| "Could not resize window")?;
    window
        .set_position(PhysicalPosition::new(rect.x, rect.y))
        .map_err(|_| "Could not position window")?;
    Ok(())
}

fn move_current_window(
    app: &AppHandle,
    window: &WebviewWindow,
    id: &str,
    layout: TileLayout,
) -> Result<Value, String> {
    let target = resolve_monitor(window, id)?;
    // Reject certainly impossible layouts before changing native state.
    tile_bounds(
        work_area(&target),
        target.scale_factor(),
        Frame::default(),
        layout,
    )?;
    let state = app.state::<NativeState>();
    let _moving = begin_move(&state.moving, window.label())?;
    let mut previous = {
        let saved = state
            .layout
            .lock()
            .map_err(|_| "Window state is unavailable")?;
        if window.label() == "main" {
            saved.main.as_ref()
        } else {
            saved.windows.get(window.label())
        }
        .cloned()
        .ok_or("Current window has no saved placement")?
    };
    let was_maximized = window
        .is_maximized()
        .map_err(|_| "Could not read window state")?;
    window
        .unminimize()
        .map_err(|_| "Could not restore window")?;
    window
        .unmaximize()
        .map_err(|_| "Could not unmaximize window")?;
    let old_position = window
        .outer_position()
        .map_err(|_| "Could not read window position")?;
    let old_size = window
        .inner_size()
        .map_err(|_| "Could not read window size")?;
    previous.x = old_position.x;
    previous.y = old_position.y;
    previous.width = old_size.width;
    previous.height = old_size.height;
    previous.maximized = was_maximized;
    let result = (|| {
        let current_scale = window
            .scale_factor()
            .map_err(|_| "Could not read window scale")?;
        if !current_scale.is_finite() || current_scale <= 0.0 {
            return Err("Window scale is invalid".into());
        }
        let old_frame = frame(window)?;
        let ratio = target.scale_factor() / current_scale;
        let estimated_frame = Frame {
            width: (old_frame.width as f64 * ratio).ceil() as u32,
            height: (old_frame.height as f64 * ratio).ceil() as u32,
        };
        let initial = tile_bounds(
            work_area(&target),
            target.scale_factor(),
            estimated_frame,
            layout,
        )?;
        apply_rect(window, initial)?;
        // Getter round trips flush the dispatcher; now use actual destination
        // decoration metrics, not source-monitor logical or physical dimensions.
        let _ = window
            .inner_size()
            .map_err(|_| "Could not read moved window")?;
        let target = resolve_monitor(window, id)?;
        let actual_frame = frame(window)?;
        let bounds = tile_bounds(
            work_area(&target),
            target.scale_factor(),
            actual_frame,
            layout,
        )?;
        apply_rect(window, bounds)?;
        let position = window
            .outer_position()
            .map_err(|_| "Could not verify window position")?;
        let size = window
            .inner_size()
            .map_err(|_| "Could not verify window size")?;
        let outer = window
            .outer_size()
            .map_err(|_| "Could not verify window frame")?;
        let current = window
            .current_monitor()
            .map_err(|_| "Could not verify current monitor")?;
        let slot = tile_bounds(
            work_area(&target),
            target.scale_factor(),
            Frame::default(),
            layout,
        )?;
        if current.as_ref().map(monitor_id).as_deref() != Some(id)
            || position.x != bounds.x
            || position.y != bounds.y
            || size.width < (640.0 * target.scale_factor()).ceil() as u32
            || size.height < (480.0 * target.scale_factor()).ceil() as u32
            || outer.width > slot.width
            || outer.height > slot.height
        {
            return Err(
                "The window manager could not fit this layout on the selected monitor".into(),
            );
        }
        let mut placement = previous.clone();
        placement.x = position.x;
        placement.y = position.y;
        placement.width = size.width;
        placement.height = size.height;
        placement.maximized = layout == TileLayout::Full;
        if placement.maximized {
            window.maximize().map_err(|_| "Could not maximize window")?;
            if !window
                .is_maximized()
                .map_err(|_| "Could not verify maximized window")?
            {
                return Err("The window manager did not maximize the window".into());
            }
        }
        // No window calls while holding layout: native event callbacks acquire it.
        let mut saved = state
            .layout
            .lock()
            .map_err(|_| "Window state is unavailable")?;
        let entry = if window.label() == "main" {
            saved.main.as_mut()
        } else {
            saved.windows.get_mut(window.label())
        }
        .ok_or("Current window has no saved placement")?;
        // Preserve ownership even if profile selection changed during dispatch.
        entry.x = placement.x;
        entry.y = placement.y;
        entry.width = placement.width;
        entry.height = placement.height;
        entry.maximized = placement.maximized;
        save(&state, &saved)?;
        Ok(Value::Null)
    })();
    if result.is_err() {
        // Best effort rollback; a hot-unplug can make the old location unavailable.
        if place(window, &previous).is_err() {
            return Err("Window placement failed and its previous geometry could not be restored. Refresh the monitor list.".into());
        }
    }
    result
}

fn place(window: &WebviewWindow, saved: &Placement) -> Result<(), String> {
    let monitors = window
        .available_monitors()
        .map_err(|_| "Could not enumerate monitors")?;
    let areas = monitors.iter().map(work_area).collect::<Vec<_>>();
    let visible = visible_bounds(saved.bounds(), &areas);
    let target = monitors
        .iter()
        .find(|m| {
            let area = work_area(m);
            visible.x >= area.x
                && visible.y >= area.y
                && (visible.x as i64) < area.x as i64 + area.width as i64
                && (visible.y as i64) < area.y as i64 + area.height as i64
        })
        .ok_or("No monitor is available to restore the window")?;
    window
        .unmaximize()
        .map_err(|_| "Could not restore window state")?;
    let scale = window
        .scale_factor()
        .map_err(|_| "Could not read window scale")?;
    if !scale.is_finite() || scale <= 0.0 {
        return Err("Window scale is invalid".into());
    }
    let source_frame = frame(window)?;
    let ratio = target.scale_factor() / scale;
    let estimated = Frame {
        width: (source_frame.width as f64 * ratio).ceil() as u32,
        height: (source_frame.height as f64 * ratio).ceil() as u32,
    };
    let initial = restore_bounds(
        saved.bounds(),
        work_area(target),
        target.scale_factor(),
        estimated,
    )?;
    apply_rect(window, initial)?;
    let _ = window
        .inner_size()
        .map_err(|_| "Could not read restored window")?;
    let rect = restore_bounds(
        saved.bounds(),
        work_area(target),
        target.scale_factor(),
        frame(window)?,
    )?;
    apply_rect(window, rect)?;
    if saved.maximized {
        window.maximize().map_err(|_| "Could not maximize window")?;
    }
    Ok(())
}

fn attach_events(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        let state = app.state::<NativeState>();
        if matches!(event, WindowEvent::CloseRequested { .. }) && label == "main" {
            state.exiting.store(true, Ordering::SeqCst);
            if let Ok(layout) = state.layout.lock() {
                let _ = save(&state, &layout);
            }
            app.exit(0);
            return;
        }
        if state.exiting.load(Ordering::SeqCst) {
            return;
        }
        if matches!(event, WindowEvent::Destroyed) {
            if let Ok(mut layout) = state.layout.lock() {
                layout.windows.remove(&label);
                let _ = save(&state, &layout);
            }
            let _ = app.emit("data-changed", ());
            return;
        }
        if matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
        ) {
            if let Some(window) = app.get_webview_window(&label) {
                // Never hold the state lock while querying the window dispatcher.
                let maximized = window.is_maximized().unwrap_or(false);
                let minimized = window.is_minimized().unwrap_or(false);
                let position = window.outer_position().ok();
                let size = window.inner_size().ok();
                if let Ok(mut layout) = state.layout.lock() {
                    let entry = if label == "main" {
                        layout.main.as_mut()
                    } else {
                        layout.windows.get_mut(&label)
                    };
                    if let Some(p) = entry {
                        p.maximized = maximized;
                        if !minimized && !maximized {
                            if let Some(pos) = position {
                                p.x = pos.x;
                                p.y = pos.y;
                            }
                            if let Some(size) = size {
                                p.width = size.width;
                                p.height = size.height;
                            }
                        }
                        let _ = save(&state, &layout);
                    }
                }
            }
        }
    });
}

fn create(app: &AppHandle, label: &str, placement: &Placement) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window
            .unminimize()
            .map_err(|_| "Could not restore detached window")?;
        window
            .set_focus()
            .map_err(|_| "Could not focus detached window")?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("News Terminal · Detached workspace")
        .inner_size(1060.0, 760.0)
        .min_inner_size(640.0, 480.0)
        .visible(false)
        .build()
        .map_err(|_| "Could not create detached window")?;
    if let Err(error) = place(&window, placement) {
        let _ = window.close();
        return Err(error);
    }
    attach_events(&window);
    window
        .show()
        .map_err(|_| "Could not show detached window")?;
    Ok(())
}

pub fn reconcile(app: &AppHandle) -> Result<(), String> {
    let removed = {
        let backend = app.state::<crate::Backend>();
        let database = backend.database()?;
        let state = app.state::<NativeState>();
        let mut layout = state
            .layout
            .lock()
            .map_err(|_| "Window state is unavailable")?;
        let removed = reconcile_layout(&mut layout, |profile, tab| {
            database.workspace_owner_exists(profile, tab)
        })?;
        save(&state, &layout)?;
        removed
    };
    // Window destruction callbacks also acquire layout; close only after releasing it.
    for label in removed {
        if let Some(window) = app.get_webview_window(&label) {
            window
                .close()
                .map_err(|_| "Could not close obsolete workspace window")?;
        }
    }
    Ok(())
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let directory = std::env::var_os("NEWS_TERMINAL_DATA_DIR")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .map_err(|_| "Could not locate application data")
        })?;
    fs::create_dir_all(&directory).map_err(|_| "Could not create application data directory")?;
    let path = directory.join("workspace-windows.json");
    let mut layout: Layout = fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .or_else(|| {
            fs::read(path.with_extension("bak"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
        })
        .unwrap_or_default();
    // Bound corrupted/imported configuration before native resources are allocated.
    layout.windows.retain(|label, p| {
        label.starts_with("detached-")
            && label.len() == 33
            && !p.profile_id.is_empty()
            && !p.tab_id.is_empty()
    });
    {
        let backend = app.state::<crate::Backend>();
        let database = backend.database()?;
        reconcile_layout(&mut layout, |profile, tab| {
            database.workspace_owner_exists(profile, tab)
        })?;
    }
    let restored: Vec<_> = layout
        .windows
        .iter()
        .take(32)
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    layout.windows = restored.iter().cloned().collect();
    let main = app
        .get_webview_window("main")
        .ok_or("Main window is missing")?;
    // The old main-window config used 800 × 600; both native window kinds now
    // share the placement contract's logical minimum, independent of DPI.
    main.set_min_size(Some(tauri::LogicalSize::new(640.0, 480.0)))
        .map_err(|_| "Could not set the main window minimum size")?;
    if let Some(saved) = &layout.main {
        place(&main, saved)?;
    }
    if layout.main.is_none() {
        let position = main.outer_position().ok();
        let size = main.inner_size().ok();
        let monitor = main.current_monitor().ok().flatten().or_else(|| {
            main.available_monitors()
                .ok()
                .and_then(|m| m.first().cloned())
        });
        let rect = initial_main_rect(
            position.map(|pos| (pos.x, pos.y)),
            size.map(|s| (s.width, s.height)),
            monitor
                .as_ref()
                .map(|monitor| (work_area(monitor), monitor.scale_factor())),
        )?;
        layout.main = Some(Placement {
            profile_id: "default".into(),
            tab_id: String::new(),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            maximized: false,
        });
    }
    app.manage(NativeState {
        layout: Mutex::new(layout),
        moving: Mutex::new(BTreeSet::new()),
        path,
        exiting: AtomicBool::new(false),
    });
    {
        let state = app.state::<NativeState>();
        let layout = state
            .layout
            .lock()
            .map_err(|_| "Window state is unavailable")?;
        save(&state, &layout)?;
    }
    attach_events(&main);
    for (label, saved) in restored {
        if create(app, &label, &saved).is_err() {
            let state = app.state::<NativeState>();
            if let Ok(mut layout) = state.layout.lock() {
                layout.windows.remove(&label);
                let _ = save(&state, &layout);
            };
        }
    }
    Ok(())
}

fn text<'a>(request: &'a Value, field: &str) -> Result<&'a str, String> {
    request[field]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 200)
        .ok_or_else(|| format!("Invalid {field}"))
}

pub fn handle(
    app: &AppHandle,
    window: &WebviewWindow,
    request: &Value,
) -> Option<Result<Value, String>> {
    let op = request["op"].as_str()?;
    if !matches!(
        op,
        "open_original"
            | "window_context"
            | "window_set_profile"
            | "detach_tab"
            | "reattach_tab"
            | "window_monitors"
            | "window_move"
    ) {
        return None;
    }
    Some((|| {
        if op == "window_monitors" {
            return monitors(window);
        }
        if op == "window_move" {
            let layout = match text(request, "layout")? {
                "full" => TileLayout::Full,
                "left" => TileLayout::Left,
                "right" => TileLayout::Right,
                _ => return Err("Invalid layout. Choose full, left, or right.".into()),
            };
            return move_current_window(app, window, text(request, "monitorId")?, layout);
        }
        if op == "open_original" {
            let raw = request["url"]
                .as_str()
                .filter(|s| s.len() <= 8192)
                .ok_or("Invalid story URL")?;
            let url = url::Url::parse(raw).map_err(|_| "Invalid story URL")?;
            if !matches!(url.scheme(), "https" | "http")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Only public HTTP or HTTPS story links can be opened".into());
            }
            app.opener()
                .open_url(url.as_str(), None::<&str>)
                .map_err(|_| "Could not open the system browser")?;
            return Ok(Value::Null);
        }
        let state = app.state::<NativeState>();
        if op == "window_context" {
            let layout = state
                .layout
                .lock()
                .map_err(|_| "Window state is unavailable")?;
            let owned = layout.windows.get(window.label());
            let detached: Vec<_> = layout
                .windows
                .iter()
                .map(|(label, p)| json!({"label":label,"profileId":p.profile_id,"tabId":p.tab_id}))
                .collect();
            return Ok(
                json!({"label":window.label(),"detached":owned.is_some(),"profileId":owned.or(layout.main.as_ref()).map(|p|&p.profile_id),"tabId":owned.map(|p|&p.tab_id),"detachedTabs":detached}),
            );
        }
        let profile_id = text(request, "profileId")?;
        if op == "window_set_profile" {
            if window.label() != "main" {
                return Err("Detached windows retain their owning profile".into());
            }
            let backend = app.state::<crate::Backend>();
            let database = backend.database()?;
            if !database.workspace_owner_exists(profile_id, None)? {
                return Err("Unknown profile".into());
            }
            let mut layout = state
                .layout
                .lock()
                .map_err(|_| "Window state is unavailable")?;
            let main = layout.main.as_mut().ok_or("Main window layout missing")?;
            main.profile_id = profile_id.into();
            save(&state, &layout)?;
            return Ok(Value::Null);
        }
        let tab_id = text(request, "tabId")?;
        let hash =
            Sha256::digest(format!("{}:{}:{}", profile_id.len(), profile_id, tab_id).as_bytes());
        let label = format!(
            "detached-{}",
            hash[..12]
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        if op == "reattach_tab" {
            {
                let mut layout = state
                    .layout
                    .lock()
                    .map_err(|_| "Window state is unavailable")?;
                layout.windows.remove(&label);
                save(&state, &layout)?;
            }
            if let Some(detached) = app.get_webview_window(&label) {
                detached
                    .close()
                    .map_err(|_| "Could not close detached window")?;
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
        } else {
            let position = window
                .outer_position()
                .map_err(|_| "Could not read window position")?;
            let placement = {
                let mut layout = state
                    .layout
                    .lock()
                    .map_err(|_| "Window state is unavailable")?;
                if layout.windows.len() >= 32 && !layout.windows.contains_key(&label) {
                    return Err(
                        "Up to 32 detached windows are supported. Reattach a window first.".into(),
                    );
                }
                let p = layout
                    .windows
                    .entry(label.clone())
                    .or_insert_with(|| Placement {
                        profile_id: profile_id.into(),
                        tab_id: tab_id.into(),
                        x: position.x.saturating_add(40),
                        y: position.y.saturating_add(40),
                        width: 1060,
                        height: 760,
                        maximized: false,
                    })
                    .clone();
                save(&state, &layout)?;
                p
            };
            if let Err(error) = create(app, &label, &placement) {
                if let Ok(mut layout) = state.layout.lock() {
                    layout.windows.remove(&label);
                    let _ = save(&state, &layout);
                }
                return Err(error);
            }
        }
        let _ = app.emit("data-changed", ());
        Ok(Value::Null)
    })())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_identity_tracks_name_and_origin_not_enumeration_order() {
        let first = monitor_identity(Some("DISPLAY1"), 0, 0);
        let left = monitor_identity(Some("DISPLAY2"), -2560, -200);
        assert_ne!(first, left);
        assert_eq!(left, monitor_identity(Some("DISPLAY2"), -2560, -200));
        assert_ne!(left, monitor_identity(Some("DISPLAY2"), 0, 0));
        assert_ne!(first, monitor_identity(None, 0, 0));
    }

    #[test]
    fn fresh_monitor_resolution_rejects_disappeared_or_ambiguous_ids() {
        let primary = monitor_identity(Some("DISPLAY1"), 0, 0);
        let left = monitor_identity(Some("DISPLAY2"), -2560, 0);
        assert_eq!(
            unique_monitor_index(&[left.clone(), primary.clone()], &primary).unwrap(),
            1
        );
        assert!(unique_monitor_index(std::slice::from_ref(&primary), &left).is_err());
        assert!(unique_monitor_index(&[primary.clone(), primary.clone()], &primary).is_err());
        assert!(unique_monitor_index(&[], &primary).is_err());
    }

    #[test]
    fn moves_are_exclusive_per_window_without_holding_dispatcher_locks() {
        let active = Mutex::new(BTreeSet::new());
        let first = begin_move(&active, "main").unwrap();
        assert!(active.try_lock().is_ok());
        assert!(begin_move(&active, "main").is_err());
        let other = begin_move(&active, "detached-one").unwrap();
        drop(first);
        assert!(begin_move(&active, "main").is_ok());
        drop(other);
        assert!(active.lock().unwrap().is_empty());
    }

    #[test]
    fn default_main_rect_centers_first_run_without_native_position() {
        let work = Rect {
            x: -1920,
            y: 40,
            width: 1920,
            height: 1040,
        };
        let rect = default_main_rect(work, 1.0, Some((1440, 900))).unwrap();
        assert_eq!(rect.width, 1440);
        assert_eq!(rect.height, 900);
        assert!(rect.x >= work.x);
        assert!(rect.y >= work.y);
        assert!(rect.x as i64 + rect.width as i64 <= work.x as i64 + work.width as i64);
        assert!(rect.y as i64 + rect.height as i64 <= work.y as i64 + work.height as i64);
    }

    #[test]
    fn default_main_rect_clamps_to_small_or_high_dpi_work_area() {
        let work = Rect {
            x: 0,
            y: 0,
            width: 1000,
            height: 700,
        };
        let rect = default_main_rect(work, 1.5, None).unwrap();
        assert_eq!(rect.width, 1000);
        assert_eq!(rect.height, 700);
        assert_eq!(rect.x, 0);
        assert_eq!(rect.y, 0);
        assert!(default_main_rect(work, 0.0, None).is_err());
    }

    #[test]
    fn initial_main_rect_uses_available_monitor_when_native_position_is_missing() {
        let work = Rect {
            x: -1600,
            y: 0,
            width: 1600,
            height: 900,
        };
        let rect = initial_main_rect(None, Some((1200, 800)), Some((work, 1.0))).unwrap();
        assert_eq!(rect.width, 1200);
        assert_eq!(rect.height, 800);
        assert!(rect.x >= work.x);
        assert!(rect.y >= work.y);
        assert_eq!(
            initial_main_rect(None, None, None).unwrap(),
            Rect {
                x: 0,
                y: 0,
                width: 1440,
                height: 900,
            }
        );
    }

    #[test]
    fn initial_main_rect_keeps_reported_position_without_monitor_lookup() {
        let rect = initial_main_rect(Some((40, 50)), Some((1000, 700)), None).unwrap();
        assert_eq!(
            rect,
            Rect {
                x: 40,
                y: 50,
                width: 1000,
                height: 700,
            }
        );
    }

    #[test]
    fn persisted_geometry_roundtrips_without_changing_detached_ownership() {
        let directory = tempfile::tempdir().unwrap();
        let state = NativeState {
            layout: Mutex::new(Layout::default()),
            moving: Mutex::new(BTreeSet::new()),
            path: directory.path().join("workspace-windows.json"),
            exiting: AtomicBool::new(false),
        };
        let placement = Placement {
            profile_id: "owned-profile".into(),
            tab_id: "owned-tab".into(),
            x: -2560,
            y: -200,
            width: 1256,
            height: 1342,
            maximized: false,
        };
        let mut layout = Layout::default();
        layout
            .windows
            .insert("detached-kept".into(), placement.clone());
        layout.main = Some(Placement {
            profile_id: "main-profile".into(),
            tab_id: String::new(),
            maximized: true,
            ..placement
        });
        save(&state, &layout).unwrap();
        let restored: Layout = serde_json::from_slice(&fs::read(&state.path).unwrap()).unwrap();
        let detached = &restored.windows["detached-kept"];
        assert_eq!(detached.profile_id, "owned-profile");
        assert_eq!(detached.tab_id, "owned-tab");
        assert_eq!(
            detached.bounds(),
            Rect {
                x: -2560,
                y: -200,
                width: 1256,
                height: 1342
            }
        );
        assert!(!detached.maximized);
        let main = restored.main.unwrap();
        assert_eq!(main.profile_id, "main-profile");
        assert!(main.maximized);
        layout.windows.clear();
        save(&state, &layout).unwrap();
        let backup: Layout =
            serde_json::from_slice(&fs::read(state.path.with_extension("bak")).unwrap()).unwrap();
        assert!(backup.windows.contains_key("detached-kept"));
    }

    #[test]
    fn import_reconciliation_prunes_orphans_and_restores_a_valid_main_profile() {
        let mut layout = Layout::default();
        let placement = Placement {
            profile_id: "removed".into(),
            tab_id: "missing".into(),
            x: 0,
            y: 0,
            width: 800,
            height: 600,
            maximized: false,
        };
        layout.main = Some(placement.clone());
        layout.windows.insert("orphan".into(), placement);
        layout.windows.insert(
            "valid".into(),
            Placement {
                profile_id: "default".into(),
                tab_id: "home".into(),
                x: 0,
                y: 0,
                width: 800,
                height: 600,
                maximized: false,
            },
        );
        let removed = reconcile_layout(&mut layout, |profile, tab| {
            Ok(profile == "default" && tab.is_none_or(|t| t == "home"))
        })
        .unwrap();
        assert_eq!(removed, vec!["orphan"]);
        assert_eq!(layout.windows.len(), 1);
        assert_eq!(layout.main.unwrap().profile_id, "default");
    }
}
