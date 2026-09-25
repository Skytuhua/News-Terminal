import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { dispatch } from "./ipc";
import { date } from "./model";
import type { LiveItem, LiveStatus } from "./types";
const eventDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Time unavailable";

const sameItem = (a: LiveItem, b: LiveItem) => a.id === b.id && a.title === b.title && a.url === b.url && a.discussionUrl === b.discussionUrl && a.by === b.by && a.score === b.score && a.publishedAt === b.publishedAt && a.receivedAt === b.receivedAt;
const LiveRows = memo(function LiveRows({ rows, open }: { rows: LiveItem[]; open: (url: string) => Promise<void> }) {
  return <div className="live-list">{rows.map(item => <article className="live-row" key={item.id}>
    <div className="row-meta"><span>{item.by || "Unknown author"} · {item.score} points</span><span className="tag">HN discussion</span></div>
    <h3>{item.title}</h3><div className="live-times"><span>Published {eventDate(item.publishedAt)}</span><span>Received {eventDate(item.receivedAt)}</span></div>
    <div className="form-actions"><button className="quiet" onClick={() => void open(item.discussionUrl)}>Open HN discussion <ExternalLink size={13} /></button>{item.url && item.url !== item.discussionUrl && <button className="quiet" onClick={() => void open(item.url)}>Open linked original <ExternalLink size={13} /></button>}</div>
  </article>)}</div>;
});

export default function LiveDiscussion() {
  const [status, setStatus] = useState<LiveStatus>();
  const [rows, setRows] = useState<LiveItem[]>([]);
  const rowsRef = useRef<LiveItem[]>([]);
  const initialized = useRef(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  const [checkedAt, setCheckedAt] = useState<number>();
  function accept(value: LiveStatus) {
    setStatus(value); setCheckedAt(Date.now() / 1000);
    if (!value.enabled) {
      initialized.current = false;
      if (rowsRef.current.length) { rowsRef.current = []; setRows([]); }
      return;
    }
    const items = new Map(value.items.map(item => [item.id, item]));
    // Keep reading order and unchanged identities; apply removals and metadata.
    const next = initialized.current ? rowsRef.current.flatMap(item => {
      const incoming = items.get(item.id);
      return incoming ? [sameItem(item, incoming) ? item : incoming] : [];
    }) : value.items;
    if (value.items.length) initialized.current = true;
    if (next.length !== rowsRef.current.length || next.some((item, index) => item !== rowsRef.current[index])) {
      rowsRef.current = next; setRows(next);
    }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
  useEffect(() => {
    const version = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let interval = 1000;
    let polling = false;
    function schedule() {
      clearTimeout(timer);
      if (version === generation.current) timer = setTimeout(() => void poll(), document.visibilityState === "hidden" ? 5000 : interval);
    }
    function recheck() {
      if (document.visibilityState === "hidden") return;
      clearTimeout(timer);
      void poll();
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") { if (!polling) schedule(); }
      else recheck();
    }
    async function poll() {
      if (version !== generation.current || polling) return;
      polling = true;
      try {
        const next = await dispatch<LiveStatus>({ op: "live_status" });
        if (version === generation.current) { interval = next.enabled ? 1000 : 5000; accept(next); setError(""); }
      } catch (e) { if (version === generation.current) setError(String(e)); }
      finally { polling = false; schedule(); }
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", recheck);
    void poll();
    return () => {
      ++generation.current;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", recheck);
    };
  }, [refresh]);
  async function setEnabled(enabled: boolean) {
    ++generation.current;
    setBusy(true); setActionError("");
    try {
      const changed = await dispatch<LiveStatus>({ op: "live_set", enabled });
      if (mounted.current) { accept(changed); setError(""); }
      // A status-read failure does not erase the mutation's confirmed snapshot.
      // Conversely, a failed mutation never invents an off/connected state.
      let readback: LiveStatus;
      try { readback = await dispatch<LiveStatus>({ op: "live_status" }); }
      catch (e) { if (mounted.current) setError(String(e)); return; }
      if (mounted.current) accept(readback);
      if (readback.enabled !== enabled) throw new Error("Stream setting was not confirmed. Retry.");
    } catch (e) { if (mounted.current) setActionError(String(e)); }
    finally { if (mounted.current) { setBusy(false); setRefresh(v => v + 1); } }
  }
  const open = useCallback(async (url: string) => {
    setActionError("");
    try { await dispatch({ op: "open_original", url }); }
    catch (e) { if (mounted.current) setActionError(String(e)); }
  }, []);
  const acceptedIds = useMemo(() => new Set(rows.map(item => item.id)), [rows]);
  const pending = status?.items.filter(item => !acceptedIds.has(item.id)) || [];
  return <main className="desk-report" aria-label="Live discussion">
    <header className="report-heading"><div><h2>Live discussion</h2><p>Hacker News · official Firebase event stream</p></div><button className={status?.enabled === false ? "primary" : ""} disabled={busy} onClick={() => void setEnabled(status?.enabled === false)}>{busy ? "Updating stream…" : status?.enabled === false ? "Connect HN stream" : "Disconnect stream"}</button></header>
    <div className="live-status">
      <strong>{status ? `Stream ${status.state}` : error ? "Stream status unknown" : "Checking stream status…"}</strong>
      {status?.message && <p>{status.message}</p>}
      <dl><div><dt>Last transport event</dt><dd>{status?.lastEventAt ? eventDate(status.lastEventAt) : "None observed"}</dd></div><div><dt>Last item received</dt><dd>{status?.lastItemAt ? eventDate(status.lastItemAt) : "None received"}</dd></div><div><dt>Local status checked</dt><dd>{checkedAt ? date(checkedAt) : "Waiting"}</dd></div>{status?.retryAt && <div><dt>Retry scheduled</dt><dd>{eventDate(status.retryAt)}</dd></div>}</dl>
      <p className="fine">One native stream is shared across windows and stays on until disconnected. This view checks local status every second while visible and enabled, or every five seconds while off or hidden, and rechecks when you return; RSS feeds are not polled every second.</p>
    </div>
    {error && <p className="form-error" role="alert">Live status unavailable: {error}. Displayed items may be stale. <button onClick={() => setRefresh(v => v + 1)}>Retry status</button></p>}
    {actionError && <p className="form-error" role="alert">Action failed: {actionError}. Retry the action when available.</p>}
    <div className="live-disclosure"><span className="tag">Discussion, not verified reporting</span><p>Initial snapshot is not newly published news. Publication and receipt times are separate; a connected transport does not guarantee new items.</p></div>
    {pending.length > 0 && <button className="live-new" onClick={() => { rowsRef.current = status!.items; setRows(status!.items); }}>{pending.length} received items · Show latest</button>}
    <LiveRows rows={rows} open={open} />
    {!rows.length && !pending.length && <div className="empty"><h3>{!status ? "Stream state is unavailable" : status.enabled ? "Waiting for discussion items" : "Live stream is off"}</h3><p>{!status ? "The shared stream may still be running. You can disconnect without a successful status read." : status.enabled ? "Items appear when the native stream supplies them. No stories have been fabricated." : "Connect to receive public story metadata from Hacker News. No account or AI processing is required."}</p></div>}
  </main>;
}
