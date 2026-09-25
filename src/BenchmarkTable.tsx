import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { dispatch } from "./ipc";
import { MetadataFreshness } from "./ModelCatalog";
import type { BenchmarkPanel, BenchmarkSnapshot, BenchmarkRow } from "./types";

function valueLabel(row: BenchmarkRow) {
  if (row.value == null) return "Missing";
  return `${Number(row.value.toFixed(2))}${row.unit === "percent" ? "%" : row.unit === "fraction" ? " fraction" : " rating"}`;
}
function Panel({panel, open}: {panel: BenchmarkPanel; open:(url:string)=>void}) {
  const [sort,setSort] = useState<"source"|"score"|"name"|"date">("source");
  const [query,setQuery] = useState("");
  const [page,setPage] = useState(0);
  const rows = panel.rows.filter(row => row.model.toLowerCase().includes(query.toLowerCase()));
  if (sort !== "source") rows.sort((a,b) => sort === "name" ? a.model.localeCompare(b.model) : sort === "date" ? (b.publishedAt || "").localeCompare(a.publishedAt || "") : (a.value == null ? 1 : b.value == null ? -1 : b.value - a.value));
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 25)-1));
  return <article className="benchmark-card" style={{padding:"12px 0",minWidth:0}}>
    <h4>{panel.source}</h4><MetadataFreshness value={panel} />
    <p className="fine">{panel.license}</p>
    <p className="fine">{panel.attribution}</p><p className="fine">{panel.modifications}</p>
    {panel.licenseUrl && <button onClick={() => open(panel.licenseUrl!)}>License and attribution source</button>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"8px 0"}}>
      <input type="search" aria-label={`Search ${panel.source}`} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Search systems" />
      <label>Sort within this panel <select aria-label={`Sort ${panel.source}`} value={sort} onChange={e=>{setSort(e.target.value as typeof sort);setPage(0);}}><option value="source">Source order</option><option value="score">Score (higher first)</option><option value="name">Model/system</option><option value="date">Publication date</option></select></label>
    </div>
    <div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12}}>
      <thead><tr><th>Model/system and configuration</th><th>Metric</th><th>Value</th><th>Provenance</th></tr></thead>
      <tbody>{rows.slice(current*25,current*25+25).map((row,index)=><tr key={`${row.model}:${index}`}>
        <td style={{maxWidth:220,overflowWrap:"anywhere",verticalAlign:"top"}}>{row.model}<div className="fine">{row.benchmark} · {row.category || "unknown category"}</div>
          {row.agent && <div>Agent: {row.agent}</div>}{row.modelIdentity && <div>Model: {row.modelIdentity}</div>}
          <div>{Array.isArray(row.configuration) ? row.configuration.join(" · ") : row.configuration || "Configuration unspecified"}</div>
          {row.checked != null && <div>Submission checked by source: {row.checked ? "yes" : "no"}</div>}
        </td>
        <td style={{verticalAlign:"top"}}>{row.metric}</td>
        <td style={{verticalAlign:"top"}}><span>{valueLabel(row)}</span>{row.value != null && (row.confidenceLow != null || row.confidenceHigh != null) && <div className="fine">CI: {row.confidenceLow?.toFixed(2) ?? "unknown"}–{row.confidenceHigh?.toFixed(2) ?? "unknown"}</div>}{row.votes != null && <div className="fine">{row.votes.toLocaleString()} votes</div>}</td>
        <td style={{verticalAlign:"top"}}><div>Published <span>{row.publishedAt || "unknown"}</span></div><div className="fine">Version: {row.version || "unspecified"}</div>{row.modelLicense && <div className="fine">Model license: {row.modelLicense} (not dataset license)</div>}{row.sourceUrl && <button aria-label="Open benchmark source" onClick={()=>open(row.sourceUrl!)}>Source</button>}</td>
      </tr>)}</tbody>
    </table></div>
    <nav aria-label={`${panel.source} pages`} style={{display:"flex",gap:8,alignItems:"center"}}><button disabled={current===0} onClick={()=>setPage(current-1)}>Previous results</button><span>{rows.length ? current*25+1 : 0}–{Math.min((current+1)*25,rows.length)} of {rows.length}</span><button disabled={(current+1)*25>=rows.length} onClick={()=>setPage(current+1)}>Next results</button></nav>
  </article>;
}
export default function BenchmarkTable() {
  const [snapshot,setSnapshot] = useState<BenchmarkSnapshot>();
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  async function load() {
    setBusy(true);setError("");
    try {setSnapshot(await dispatch<BenchmarkSnapshot>({op:"benchmark_catalog"}));}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function open(url:string) {try{await dispatch({op:"open_original",url});}catch(e){setError(String(e));}}
  useEffect(()=>{void load();},[]);
  return <section className="benchmark-panel" aria-label="Benchmark metadata" style={{overflow:"auto",padding:12,minHeight:0}}>
    <div className="section-heading"><div><h3>Benchmarks</h3><p className="fine">No universal score. Licensed panels stay separate.</p></div><button className="icon" aria-label="Refresh benchmarks" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/></button></div>
    <p className="fine">Daily host cache shared across windows. Each source retains its own last good data on failure. Personal noncommercial use.</p>
    {error && <p className="form-error" role="alert">Benchmarks unavailable: {error}. Previously loaded data is retained.</p>}
    {snapshot && <p className="fine">{snapshot.comparisonNote}</p>}
    <div className="benchmark-grid">{snapshot?.panels.map(panel=><Panel key={panel.source} panel={panel} open={url=>void open(url)}/>)}</div>
  </section>;
}
