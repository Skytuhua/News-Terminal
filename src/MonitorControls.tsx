import { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { dispatch } from "./ipc";

type MonitorState = { currentLabel: string; monitors: { id: string; name: string; x: number; y: number; width: number; height: number; scaleFactor: number; current: boolean }[] };
export default function MonitorControls() {
  const [state, setState] = useState<MonitorState>();
  const [target, setTarget] = useState("");
  const [layout, setLayout] = useState("full");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const current = useRef(true);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  useEffect(() => {
    let active = true; setBusy(true); setError("");
    void dispatch<MonitorState>({ op: "window_monitors" }).then(value => {
      if (!active) return;
      setState(value); setTarget(old => value.monitors.some(m => m.id === old) ? old : (value.monitors.find(m => m.current) || value.monitors[0])?.id || "");
    }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [revision]);
  async function move() {
    setBusy(true); setError(""); setMessage("");
    try {
      await dispatch({ op: "window_move", monitorId: target, layout });
      const value = await dispatch<MonitorState>({ op: "window_monitors" });
      if (!current.current) return;
      setState(value);
      if (!value.monitors.find(m => m.id === target)?.current) throw new Error("The target monitor was not confirmed. Reload displays and retry.");
      setMessage("Window placement applied; current display confirmed by the desktop host.");
    } catch (e) { if (current.current) setError(String(e)); }
    finally { if (current.current) setBusy(false); }
  }
  return <>
    <p className="intro">Arrange this native window on a connected display. Detach a tab first, then open Screens in the detached window to move only that tab. Profiles and tab ownership stay unchanged.</p>
    {error && <p role="alert" className="form-error">Screen controls unavailable: {error}</p>}
    {message && <p role="status" className="form-success">{message}</p>}
    {state && <>
      <p className="fine">Window: {state.currentLabel}</p><p className="current-monitor">Current display: {state.monitors.find(m => m.current)?.name || "Not identified"}</p>
      <div className="monitor-list">{state.monitors.map(m => <div className="monitor-row" key={m.id}><Monitor size={24} /><div><strong>{m.name}</strong><p className="fine">{m.width} × {m.height} · {Math.round(m.scaleFactor * 100)}% scale · Position {m.x}, {m.y}</p></div>{m.current && <span className="tag">Current</span>}</div>)}</div>
      {!state.monitors.length && <p className="intro">No displays were reported. Reload after connecting a display.</p>}
      <div className="form-grid"><label className="field">Target monitor<select value={target} onChange={e => setTarget(e.target.value)} disabled={busy}>{state.monitors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="field">Window arrangement<select value={layout} disabled={busy} onChange={e => setLayout(e.target.value)}><option value="full">Full work area</option><option value="left">Left half</option><option value="right">Right half</option></select></label></div>
    </>}
    <div className="form-actions"><button className="primary" disabled={busy || !target || !state?.monitors.some(m => m.id === target)} onClick={() => void move()}>Move this window</button><button disabled={busy} onClick={() => setRevision(v => v + 1)}>{busy ? "Reading displays…" : "Reload displays"}</button></div>
    <p className="fine monitor-note">Coordinates describe physical display work areas, including negative positions and mixed scaling. A disconnected target fails safely rather than moving to another display.</p>
  </>;
}
