import { useState } from "react";
import { dispatch, type Request } from "./ipc";
import type { Source } from "./types";

type Service = "mastodon" | "lemmy" | "youtube";

const externalSites = [
  ["Bluesky", "https://bsky.app/"],
  ["Reddit", "https://www.reddit.com/"],
  ["X", "https://x.com/"],
];

const discoveryLinks = [
  ["Bluesky AI search", "https://bsky.app/search?q=AI%20news"],
  ["Reddit technology search", "https://www.reddit.com/search/?q=technology%20news"],
  ["X stocks search", "https://x.com/search?q=stocks%20news&src=typed_query"],
];

function feedUrl(service: Service, input: string) {
  if (service === "youtube") {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(input)) throw new Error("Enter an exact YouTube channel ID: UC followed by 22 characters. Handles and watch URLs are not channel IDs.");
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${input}`;
  }
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new Error("Use a public HTTPS account or community URL without credentials, port or fragment.");
  if (service === "mastodon") {
    if (url.search || !/^\/@[A-Za-z0-9_]+(?:\.rss)?$/.test(url.pathname)) throw new Error("Use https://instance/@account or its official .rss feed.");
    return `${url.origin}${url.pathname.endsWith(".rss") ? url.pathname : `${url.pathname}.rss`}`;
  }
  const match = url.pathname.match(/^\/(?:c\/([a-zA-Z0-9_]+)|feeds\/c\/([a-zA-Z0-9_]+)\.xml)$/);
  if (!match || (url.search && url.search !== "?sort=New")) throw new Error("Use https://instance/c/community or its official community XML feed with sort=New.");
  return `${url.origin}/feeds/c/${match[1] || match[2]}.xml?sort=New`;
}

export default function Connections({ sources, run, busy }: { sources: Source[]; run: (request: Request, success: string) => Promise<boolean>; busy: boolean }) {
  const [service, setService] = useState<Service>("mastodon");
  const [error, setError] = useState("");
  const connections = sources.filter(s => /\/@[^/]+\.rss$|\/feeds\/c\/|youtube\.com\/feeds\/videos\.xml/.test(s.url));
  async function open(url: string) { try { await dispatch({ op: "open_original", url }); } catch (e) { setError(String(e)); } }
  return <>
    <p className="intro">Connect public accounts and communities through their official feeds. No sign-in, private timelines, comments archive or hidden scraping. Instance terms apply independently.</p>
    {connections.length > 0 && <div className="setting-rows">{connections.map(s => <div className="source-row" key={s.id}><strong>{s.name}</strong><p className="fine">Scheduled feed - {s.enabled ? "Enabled" : "Disabled"} - {s.status}</p><p className="connection-url">{s.url}</p></div>)}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="connection-form" onSubmit={async e => {
      e.preventDefault(); setError(""); const form = e.currentTarget; const f = new FormData(form);
      try {
        if (!f.has("acknowledged")) throw new Error("Review and acknowledge the source terms first.");
        const url = feedUrl(service, String(f.get("target")).trim());
        const termsUrl = String(f.get("termsUrl")).trim();
        const terms = new URL(termsUrl);
        if (terms.protocol !== "https:" || terms.username || terms.password) throw new Error("Terms must be a public HTTPS URL without credentials.");
        if (sources.some(s => s.url === url)) throw new Error("This official feed is already configured. Manage it in Sources & health.");
        const name = String(f.get("name")).trim();
        if (await run({ op: "source_add", name, url, termsUrl, topics: service === "youtube" ? ["video"] : [], region: "world", language: String(f.get("language")).trim(), kind: "discussion", storage: "metadata", aiAllowed: false, mediaAllowed: false, enabled: true, accessMode: "approval-free", sourceAdapter: "feed", publisher: name, imagesAvailable: false }, "Connection saved. It uses scheduled RSS refresh, not a live stream.")) form.reset();
      } catch (e) { setError(String(e)); }
    }}>
      <label className="field">Service<select aria-label="Service" value={service} onChange={e => { setService(e.target.value as Service); setError(""); }}><option value="mastodon">Mastodon account RSS</option><option value="lemmy">Lemmy community RSS</option><option value="youtube">YouTube channel discovery</option></select></label>
      <p className="fine connection-help">{service === "mastodon" ? "Official path: https://instance/@account.rss. Public streaming requires separate authorization; this is scheduled RSS." : service === "lemmy" ? "Official path: https://instance/feeds/c/community.xml?sort=New. Public community metadata only." : "Video discovery only. Enter the exact UC channel ID; items link to the original watch page, never downloadable video."} All connections store titles and links only; AI and media fetching are disabled. Refresh respects the native source schedule (30-minute default).</p>
      <label className="field">Connection name<input required name="name" maxLength={100} /></label>
      <label className="field">Account or community URL / channel ID<input required name="target" spellCheck={false} placeholder={service === "youtube" ? "UC...(24 characters)" : service === "mastodon" ? "https://instance/@account" : "https://instance/c/community"} /></label>
      <div className="form-grid"><label className="field">Connection terms URL<input required name="termsUrl" type="url" /></label><label className="field">Connection language<input required name="language" defaultValue="en" maxLength={40} /></label></div>
      <label className="check"><input type="checkbox" name="acknowledged" required />I have reviewed these terms and have permission to access and store title/link metadata</label>
      <div className="form-actions"><button className="primary" disabled={busy}>Add connection</button></div>
    </form>
    <section className="external-connections">
      <h3>External websites</h3>
      <p className="fine">Bluesky, Reddit and X are link-only. News Terminal does not scrape them, sync accounts, store comments, track deletes or moderation actions, or treat public reachability as permission to ingest content.</p>
      {externalSites.map(([name, url]) => <div className="setting-row" key={name}><div><strong>{name}</strong><p className="fine">External only - not connected</p></div><button aria-label={`Open ${name} website`} onClick={() => void open(url)}>Open website</button></div>)}
      <h3>Discovery shortcuts</h3>
      <p className="fine">These shortcuts open public website searches in your browser. They are not feeds and do not add sources.</p>
      {discoveryLinks.map(([name, url]) => <div className="setting-row" key={name}><div><strong>{name}</strong><p className="fine">External search - no ingestion</p></div><button aria-label={`Open ${name}`} onClick={() => void open(url)}>Open search</button></div>)}
    </section>
  </>;
}
