import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { dispatch } from "./ipc";
import { date } from "./model";
import type { ModelMetadata, ModelMetadataSnapshot, MetadataStatus } from "./types";

export function MetadataFreshness({ value }: { value: MetadataStatus }) {
  return <p className="fine" role="status">{value.status === "stale" ? "Stale — last good data" : value.status === "unavailable" ? "Unavailable" : "Cached snapshot"}{value.error ? ` · ${value.error}` : ""} · observed {value.observedAt ? date(value.observedAt) : "not yet"}{value.nextCheck ? ` · next check after ${date(value.nextCheck)}` : ""}</p>;
}

export default function ModelCatalog() {
  const [snapshot, setSnapshot] = useState<ModelMetadataSnapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [derived, setDerived] = useState(false);
  async function load() {
    setBusy(true); setError("");
    try { setSnapshot(await dispatch<ModelMetadataSnapshot>({ op: "model_catalog" })); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function open(url: string) {
    try { await dispatch({ op: "open_original", url }); } catch (e) { setError(String(e)); }
  }
  useEffect(() => { void load(); }, []);
  const matches = (model: ModelMetadata) => `${model.id} ${model.name} ${model.provider}`.toLowerCase().includes(query.toLowerCase());
  const all = (snapshot?.models || []).filter(matches);
  const current = Math.min(page, Math.max(0, Math.ceil(all.length / 25) - 1));
  const rows = all.slice(current * 25, current * 25 + 25);
  const hf = snapshot?.huggingFace;
  const hfRows = (hf?.models || []).filter(matches).filter(m => derived || m.subtype === "unspecified");
  return <section className="model-catalog" aria-label="OpenRouter model metadata" style={{overflow:"auto",padding:12, minHeight:0}}>
    <div className="section-heading">
      <div><h3>AI models</h3><p className="fine">OpenRouter metadata only. No inference requests.</p></div>
      <button className="icon" aria-label="Refresh model metadata" disabled={busy} onClick={() => void load()}><RefreshCw size={15} /></button>
    </div>
    <p className="fine">Keyless metadata · hourly host cache shared across windows. Refresh respects the cache; no paid fallback.</p>
    {error && <p className="form-error" role="alert">Model metadata unavailable: {error}. Previously loaded data is retained.</p>}
    <input type="search" aria-label="Search models" placeholder="Search all cached models" value={query} onChange={e => {setQuery(e.target.value);setPage(0);}} />
    {snapshot && <><MetadataFreshness value={snapshot} /><p className="fine">{snapshot.complete ? "Complete" : "Unavailable"} OpenRouter catalog · {snapshot.totalCount || 0} models reported · availability means listed in metadata, not tested inference.</p></>}
    {!!snapshot?.changes?.length && <details><summary>Changes in latest snapshot ({snapshot.changes.length})</summary><ul>{snapshot.changes.map(change => <li key={`${change.kind}:${change.modelId}`}>{change.label}: {change.modelId}{change.fields?.length ? ` · ${change.fields.join(", ")}` : ""}</li>)}</ul></details>}
    <div className="model-grid">
      {rows.map(model => <article key={model.id} className="model-row" style={{padding:"12px 0",borderBottom:"1px solid var(--border)",overflowWrap:"anywhere"}}>
        <strong>{model.id}</strong><div>{model.name} · {model.provider}</div>
        <div><span>{model.releaseDateLabel}</span>{model.addedToOpenRouter ? ` · ${date(model.addedToOpenRouter)}` : " · unknown"}</div>
        {model.firstSeen && <div>First seen here · {date(model.firstSeen)}</div>}
        <div>{model.contextLength != null ? `${model.contextLength.toLocaleString()} context` : "Context unspecified"} · input: {model.inputModalities?.join(", ") || "unspecified"} · output: {model.outputModalities?.join(", ") || "unspecified"}</div>
        <div>Supported parameters: {model.supportedParameters?.join(", ") || "unspecified"}</div>
        <div>Prompt: {model.pricing?.prompt ?? "unknown"} · Completion: {model.pricing?.completion ?? "unknown"} USD/token</div>
        <div className="fine">Provider-reported pricing, not a cost quote or permission to run inference.</div>
        {model.sourceUrl && <button aria-label="Open model source" onClick={() => void open(model.sourceUrl!)}>OpenRouter source</button>}
      </article>)}
    </div>
    <nav aria-label="Model pages" style={{display:"flex",gap:8,alignItems:"center"}}>
      <button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous models</button>
      <span>{all.length ? current * 25 + 1 : 0}–{Math.min((current + 1) * 25, all.length)} of {all.length}</span>
      <button disabled={(current + 1) * 25 >= all.length} onClick={() => setPage(current + 1)}>Next models</button>
    </nav>
    {hf && <section aria-label="Hugging Face selected organization">
      <h4>Hugging Face · selected organization: Qwen</h4>
      <p className="fine">{hf.scope}</p><MetadataFreshness value={hf} />
      <p className="fine">Organization identity: QwenLM/Qwen3 links to this Hugging Face organization. No cross-source aliases inferred; no model weights downloaded.</p>
      <label><input type="checkbox" checked={derived} onChange={e => setDerived(e.target.checked)} />Include adapters, quantizations, merges and fine-tunes</label>
      {hfRows.map(model => <article key={model.id} style={{padding:"12px 0",overflowWrap:"anywhere"}}>
        <strong>{model.id}</strong>
        <div>Repository created (not a release announcement) · {model.repositoryCreated || "unknown"}</div>
        <div>Repository updated · {model.repositoryUpdated || "unknown"}</div>
        <div>Subtype: {model.subtype || "unspecified"} · model license: {model.license || "unspecified"}</div>
        {!!model.baseModels?.length && <div>Reported base models: {model.baseModels.join(", ")}</div>}
        {model.sourceUrl && <button onClick={() => void open(model.sourceUrl!)}>Hugging Face source</button>}
      </article>)}
      {!hfRows.length && <p className="fine">No repositories match the current filters.</p>}
    </section>}
  </section>;
}
