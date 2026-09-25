import { useEffect, useMemo, useRef, useState } from 'react';
import type { Article } from './types';
import { dispatch, subscribe } from './ipc';
import { coalescedRead } from './coalescedRead';
import { date } from './model';

export default function HiddenStories({profileId, replacementToken, browse, isCurrent}: {profileId:string; replacementToken:string; browse:() => void; isCurrent:() => boolean}) {
  const live = useRef(false);
  const current = () => live.current && isCurrent();
  const [rows, setRows] = useState<Article[]>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string>();
  const [confirming, setConfirming] = useState<string>();
  const acknowledged = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const focusIndex = useRef<number | undefined>(undefined);
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (rows || []).filter(a => terms.every(term => `${a.title} ${a.sourceName}`.toLocaleLowerCase().includes(term)));
  const lastPage = Math.max(0, Math.ceil(matches.length / 100) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageRows = matches.slice(currentPage * 100, (currentPage + 1) * 100);
  const previousPage = useRef(currentPage);
  useEffect(() => {
    list.current?.scrollTo({top:0, behavior:'instant'});
    if (previousPage.current !== currentPage) list.current?.firstElementChild?.scrollIntoView({block:'start', behavior:'instant'});
    previousPage.current = currentPage;
  }, [currentPage, query]);
  useEffect(() => {
    if (focusIndex.current === undefined || pending || confirming) return;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button');
    if (buttons?.length) buttons[Math.min(focusIndex.current, buttons.length - 1)].focus();
    focusIndex.current = undefined;
  }, [rows, pending, currentPage]);
  async function load() {
    if (!current()) return;
    const confirmation = acknowledged.current;
    const next = await dispatch<Article[]>({op:'hidden_stories', profileId});
    if (!current()) return;
    setRows(next);
    setError('');
    // A read begun before the write acknowledgement cannot confirm that write.
    if (confirmation && confirmation === acknowledged.current) {
      if (next.some(a => a.id === acknowledged.current)) {
        setError('The story is still hidden. You can try restoring it again.');
        focusIndex.current = undefined;
      } else setNotice('Story restored');
      acknowledged.current = undefined;
      setConfirming(undefined);
    }
    return next;
  }
  function readFailed(e:unknown) {
    if (!current()) return;
    setError(`${acknowledged.current ? 'Restore acknowledged, but confirmation failed.' : 'Could not load hidden stories.'} ${String(e)} Reload to confirm the current state.`);
  }
  const read = useMemo(() => coalescedRead(async () => { await load(); }), [profileId]);
  useEffect(() => {
    live.current = true;
    void read(false, true).catch(readFailed);
    let closed = false, stop: (() => void) | undefined;
    void subscribe(() => { void read(false).catch(readFailed); }).then(fn => { if(closed) fn(); else stop = fn; }).catch(readFailed);
    return () => {closed = true; live.current = false; stop?.();};
  }, [read]);
  async function restore(article:Article) {
    if (!current() || pending || confirming) return;
    setPending(article.id); setError(''); setNotice('');
    let written = false;
    try {
      await dispatch({op:'article_state', profileId, articleId:article.id, hidden:false, replacementToken});
      if (!current()) return;
      written = true;
      acknowledged.current = article.id;
      setConfirming(article.id);
      focusIndex.current = pageRows.findIndex(a => a.id === article.id);
      if (currentPage > 0 && pageRows.length === 1) focusIndex.current = 99;
      await read(false, true);
    } catch(e) { if (!current()) return; if (written) readFailed(e); else setError(`Could not restore story. ${String(e)}`); }
    finally { if (current()) setPending(undefined); }
  }
  return <main className="hidden-stories" aria-label="Hidden stories">
    <header className="list-heading"><div><h2>Hidden stories</h2><p>Newest retrieved first · This reading profile</p></div><button onClick={() => void read(false, true).catch(readFailed)}>Reload hidden stories</button></header>
    <p className="hidden-guidance">Hidden stories are recoverable while retained in your local cache. Saving protects a story from ordinary cache cleanup.</p>
    <p className="hidden-guidance">Restoring keeps Saved and Read unchanged. Your ordinary profile filters still apply; saved stories remain available through Saved.</p>
    {error && <p role="alert">{error}</p>}
    <p role="status">{notice || (rows ? `${matches.length} hidden stories` : error ? 'Hidden stories unavailable' : 'Loading hidden stories…')}</p>
    <label className="hidden-search">Find hidden title or publisher<input type="search" value={query} onChange={e => {setQuery(e.target.value); setPage(0);}} /></label>
    <div className="hidden-list" ref={list}>
      {pageRows.map(article => <article className="hidden-row" key={article.id}><div><h3>{article.title}</h3><p>{article.sourceName} · {date(article.publishedAt)}</p><p>{article.saved ? 'Saved' : 'Not saved'} · {article.read ? 'Read' : 'Unread'}</p></div><button disabled={!!pending || !!confirming} onClick={() => void restore(article)}>{pending === article.id ? 'Restoring…' : confirming === article.id ? 'Awaiting confirmation' : 'Restore'}</button></article>)}
      {!error && !!rows?.length && !matches.length && <div className="empty"><h3>No hidden stories match</h3><p>Search titles or publishers in this profile’s retained hidden stories.</p><button onClick={() => setQuery('')}>Clear hidden search</button></div>}
      {!error && rows?.length === 0 && <div className="empty"><h3>No hidden stories</h3><p>Stories you hide in this profile will appear here while retained.</p><button onClick={browse}>Browse headlines</button></div>}
    </div>
    {matches.length > 100 && <nav className="headline-pages" aria-label="Hidden story pages">
      <button aria-label="First page" disabled={currentPage === 0} onClick={() => setPage(0)}>First</button>
      <button aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>{currentPage * 100 + 1}–{Math.min((currentPage + 1) * 100, matches.length)} of {matches.length}</span>
      <button aria-label="Next page" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
      <button aria-label="Last page" disabled={currentPage === lastPage} onClick={() => setPage(lastPage)}>Last</button>
    </nav>}
  </main>;
}
