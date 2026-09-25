import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { dispatch } from "./ipc";
import { date } from "./model";
import type { DailyBrief, Provider } from "./types";
import Summary from "./Summary";
import SectorSummary from "./SectorSummary";

export default function Briefing({ profileId, inputRevision, providers, configure }: {
  profileId: string; inputRevision: string; providers: Provider[]; configure: () => void;
}) {
  // An empty date asks the host for today's local day, not a UTC browser day.
  const [day, setDay] = useState("");
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ profileId: string; input: string; day: string; revision: number; brief: DailyBrief }>();
  // Hide superseded content synchronously, including open generated results.
  // Do not wait for the replacement request (which can fail or arrive late).
  const brief = result?.profileId === profileId && result.input === inputRevision && result.day === day && result.revision === revision ? result.brief : undefined;
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setResult(undefined);
    setError("");
    void dispatch<DailyBrief>({ op: "daily_brief", profileId, ...(day ? { date: day } : {}) })
      .then(value => { if (current) setResult({ profileId, input: inputRevision, day, revision, brief: value }); })
      .catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [profileId, day, revision, inputRevision]);
  async function open(url: string) {
    try { await dispatch({ op: "open_original", url }); }
    catch (e) { setError(String(e)); }
  }
  return <main className="desk-report" aria-label="Daily sector briefing">
    <header className="report-heading">
      <div><h2>Daily briefing</h2><p>Sector desk · retrieved stories, original sources</p></div>
      <div className="report-controls">
        <label>Briefing date<input aria-label="Briefing date" type="date" value={day || brief?.date || ""} onChange={e => setDay(e.target.value)} /></label>
        <button aria-label="Reload briefing" onClick={() => setRevision(v => v + 1)}><RefreshCw size={15} /> Reload cache</button>
      </div>
    </header>
    {error && <div className="form-error" role="alert">Briefing unavailable: {error} <button onClick={() => setRevision(v => v + 1)}>Retry briefing</button></div>}
    {!brief && !error && <p className="report-loading" role="status">Reading the local day’s coverage…</p>}
    {brief && <>
      <div className="brief-coverage">
        <strong>{brief.coverageLabel}</strong>
        <p>{brief.articleCount} dated stories · {brief.undatedCount} undated stories excluded · Snapshot {date(brief.generatedAt)}</p>
        <p>Local day ({Intl.DateTimeFormat().resolvedOptions().timeZone}): {date(brief.dayStart)} to {date(brief.dayEnd)} (end exclusive). This is not a complete account of world events.</p>
        <p>Undated items were retrieved during this day, not assigned a publication date. Sector counts may overlap; do not add them as unique stories.</p>
      </div>
      <div className="brief-layout">
        <nav className="sector-index" aria-label="Briefing sectors">{brief.sectors.map(sector => <a key={sector.id} href={`#sector-${sector.id}`}><span>{sector.title}</span><span>{sector.articleCount}</span></a>)}</nav>
        <div className="brief-sectors">
          {brief.sectors.map(sector => <section className="brief-sector" id={`sector-${sector.id}`} key={sector.id}>
            <header className="section-bar"><h3>{sector.title}</h3><span>{sector.articleCount} stories · {sector.sourceCount} sources</span></header>
            {sector.items.length ? <>
              <div className="headline-outline"><h4>Headline outline · not AI-generated</h4><ul>{sector.outline.map((line, i) => <li key={i}>{line}</li>)}</ul></div>
              <SectorSummary key={JSON.stringify([profileId, brief.date, inputRevision, providers])} profileId={profileId} day={brief.date} sectorId={sector.id} sectorTitle={sector.title} providers={providers} configure={configure} />
              <ol className="brief-items">{sector.items.map(item => <li key={item.id}>
                <div className="row-meta"><span>{item.sourceName} · {item.kind}</span><time>{date(item.publishedAt)}</time></div>
                <button className="headline" aria-label={`Open ${item.title}`} onClick={() => void open(item.url)}>{item.title}<ExternalLink size={13} /></button>
                {item.excerpt && <p className="brief-excerpt">{item.excerpt}</p>}
              </li>)}</ol>
              <details className="sector-ai"><summary>Optional AI summaries · per story</summary>
                <p className="fine">Separate generated summaries of permitted excerpts, not a combined sector assessment. Nothing is sent until you request it.</p>
                {sector.items.filter(item => item.aiAllowed).map(item => <div key={item.id} className="brief-ai-item"><h4>{item.title}</h4><Summary article={item} profileId={profileId} providers={providers} configure={configure} /></div>)}
                {!sector.items.some(item => item.aiAllowed) && <p className="fine">No stories in this sector have permission for AI processing.</p>}
              </details>
            </> : <p className="sector-empty">No cached stories in this sector for this day.</p>}
          </section>)}
          {!brief.sectors.length && <p className="sector-empty">No sectors are available for this profile. Adjust your preferences or refresh enabled feeds.</p>}
        </div>
      </div>
    </>}
  </main>;
}
