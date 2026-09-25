import { useEffect, useRef, useState } from "react";
import { dispatch } from "./ipc";
import type { Provider, SectorSummaryPreview, SectorSummaryResult } from "./types";
import { date } from "./model";
import SourceUrl from "./SourceUrl";

export default function SectorSummary({ profileId, day, sectorId, sectorTitle, providers, configure }: {
  profileId: string; day: string; sectorId: string; sectorTitle: string;
  providers: Provider[]; configure: () => void;
}) {
  const [preview, setPreview] = useState<SectorSummaryPreview>();
  const [previewError, setPreviewError] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [showInputs, setShowInputs] = useState(false);
  const [result, setResult] = useState<SectorSummaryResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const request = useRef<string | undefined>(undefined);
  // Briefing keys this component by authoritative profile/day/input identity.
  // Invalidate locally before asking the host to cancel, so late replies stay hidden.
  useEffect(() => () => {
    const id = request.current;
    request.current = undefined;
    if (id) void dispatch({ op: "summary_cancel", requestId: id }).catch(() => {});
  }, []);
  async function generate() {
    if (!preview || !ready || request.current || preview.selectedCount < 2) return;
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    setError("");
    setStatus("");
    setResult(undefined);
    try {
      const value = await dispatch<SectorSummaryResult>({ op: "sector_summarize", profileId, date: day, sectorId,
        fingerprint: preview.fingerprint, requestId: id });
      if (request.current !== id) return;
      // The host validates exact quotations against sanitized, bounded prompt inputs.
      // Preview metadata cannot repeat that check. Fail closed on legacy/mismatched
      // evidence here too; never turn a partial response into displayed quotations.
      if (!value || value.profileId !== profileId || value.date !== day || value.sectorId !== sectorId || value.fingerprint !== preview.fingerprint ||
        !Array.isArray(value.sources) || !Array.isArray(value.bullets) || !value.bullets.length ||
        value.bullets.some(b => !b || typeof b.text !== "string" || !b.text.trim() || !Array.isArray(b.citations) || b.citations.length !== 1 ||
          !Array.isArray(b.evidence) || b.evidence.length !== 1 || !b.evidence[0] ||
          b.evidence[0].sourceId !== b.citations[0] || b.evidence[0].quote !== b.text ||
          !value.sources.some(s => s && s.id === b.citations[0]))) {
        throw new Error("The summary response is invalid or superseded. No generated text was displayed.");
      }
      setResult(value);
    } catch (e) {
      if (request.current === id) {
        setError(String(e));
        // The host may have rejected a stale fingerprint. Re-preview locally;
        // never retry a provider request without another explicit user action.
        setPreview(undefined);
        setPreviewRevision(v => v + 1);
      }
    }
    finally {
      if (request.current === id) { request.current = undefined; setBusy(false); }
    }
  }
  async function cancel() {
    const id = request.current;
    request.current = undefined;
    setBusy(false);
    setStatus("Sector summary cancelled. Any late result will be discarded.");
    if (id) try { await dispatch({ op: "summary_cancel", requestId: id }); }
    catch { setError("Cancellation could not reach the provider. Any late result will be discarded."); }
  }
  async function open(url: string) {
    try { await dispatch({ op: "open_original", url }); }
    catch (e) { setError(String(e)); }
  }
  const ready = providers.some(p => p.enabled && p.consented && (p.kind === "ollama" || p.hasKey));
  useEffect(() => {
    let current = true;
    setPreview(undefined);
    setPreviewError("");
    void dispatch<SectorSummaryPreview>({ op: "sector_summary_preview", profileId, date: day, sectorId })
      .then(value => { if (current) setPreview(value); })
      .catch(e => { if (current) setPreviewError(String(e)); });
    return () => { current = false; };
  }, [profileId, day, sectorId, previewRevision]);
  const inputs = <ol className="sector-summary-sources">{(result?.sources ?? preview?.sources ?? []).map(source => <li key={source.id}>
    <p><strong>{source.id} · {source.sourceName}</strong> · {date(source.publishedAt)}</p>
    <p>{source.title}</p>
    <p className="fine">{source.inputLabel}</p>
    {source.attribution && <p className="fine">{source.attribution}</p>}
    {source.outputLabel && <p className="fine">{source.outputLabel}</p>}
    <SourceUrl url={source.url} open={() => void open(source.url)} />
  </li>)}</ol>;
  return <section className="sector-summary" aria-label={`${sectorTitle} source quotations`}>
    <div className="section-heading"><h4>Sector source quotations</h4><button className="quiet" onClick={configure}>Configure AI</button></div>
    <p className="fine">AI selects exact passages from individual source inputs; it does not combine them into a paraphrase or verify facts.</p>
    <p className="fine">On demand only. Nothing is sent to AI until you generate. Enabled, consented providers may be tried in fallback order.</p>
    {preview ? <>
      <p>{preview.selectedCount} source stories selected · {preview.eligibleCount} eligible · {preview.excludedCount} excluded</p>
      <p className="fine">{preview.coverageLabel}</p>
      <p className="fine">Up to {preview.limit} stories from this day’s displayed sector items; not all reporting on this sector.</p>
      {preview.selectedCount < preview.eligibleCount && <p className="fine">Sampled input: {preview.selectedCount} of {preview.eligibleCount} eligible stories selected.</p>}
      {!result && preview.sources.length > 0 && <details onToggle={e => setShowInputs(e.currentTarget.open)}><summary>Review selected source inputs</summary>{showInputs && inputs}</details>}
      {preview.selectedCount < 2 && <p className="fine">At least 2 permitted source stories are needed. Read the originals or use an available per-story summary below.</p>}
    </> : previewError ? <div className="form-error" role="alert">Source preview unavailable: {previewError}. Original stories remain available. <button onClick={() => setPreviewRevision(v => v + 1)}>Retry source preview</button></div>
      : <p className="fine" role="status">Checking permitted source stories…</p>}
    {!ready && <p className="fine">Enable a provider and give consent before generating.</p>}
    <div className="form-actions">{busy ? <>
      <span role="status">Selecting source quotations…</span>
      <button onClick={() => void cancel()}>Cancel sector summary</button>
    </> : <button disabled={!ready || !preview || preview.selectedCount < 2} onClick={() => void generate()}>{error || status ? "Retry sector summary" : "Generate sector summary"}</button>}</div>
    {status && <p className="fine" role="status">{status}</p>}
    {error && <p className="form-error" role="alert">Summary unavailable: {error}. Original stories remain available.</p>}
    {result && <div className="sector-summary-output">
      <h4>AI-selected source quotations · unverified</h4>
      <p className="fine">{result.warning}</p>
      <ul className="sector-summary-bullets">{result.bullets.map((bullet, i) => <li key={i}>
        <p><q>{bullet.text}</q></p>
        <div className="sector-citations">{bullet.citations.map(id => {
          const source = result.sources.find(s => s.id === id);
          return source && <button key={id} type="button" role="link" className="quiet" onClick={() => void open(source.url)}>{id} · {source.sourceName} ↗</button>;
        })}</div>
      </li>)}</ul>
      <p className="fine">{result.coverageLabel}</p>
      <p className="fine">{result.provider} · {result.model} · Generated {date(result.generatedAt)}</p>
      <h4>Source inputs</h4>
      {inputs}
    </div>}
  </section>;
}
