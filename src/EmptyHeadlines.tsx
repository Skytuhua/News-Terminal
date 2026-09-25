import type { Snapshot, Tab } from './types';
import {sourceFailed} from './model';

export default function EmptyHeadlines({ data, tab, query, kind, unread, busy, failed, retrySearch, clear, browse, refresh, sources, watchlists, hidden }: {
  data: Snapshot; tab: Tab; query: string; kind: string; unread: boolean; busy: boolean; failed: boolean;
  retrySearch: () => void; clear: () => void; browse: () => void; refresh: () => void; sources: () => void; watchlists: () => void; hidden: () => void;
}) {
  let title: string, body: string, label: string, action: () => void;
  if (busy) return <div className="empty"><p role="status">Loading stories…</p></div>;
  if (failed) return <div className="empty"><h3>Search unavailable</h3><p>Your cache has not been removed. Retry the search or browse your headlines.</p><button onClick={retrySearch}>Retry search</button><button onClick={browse}>Browse headlines</button></div>;
  const saved = data.articles.some(a => a.saved && !a.hidden);
  if (tab.mode === 'saved' && !saved) {
    const hiddenSaves = data.articles.some(a => a.saved);
    title = hiddenSaves ? 'No visible saved stories' : 'No saved stories yet';
    body = hiddenSaves ? 'Your saved stories are hidden, not deleted.' : 'Select a story and press S to save its permitted excerpt for later.';
    label = hiddenSaves ? 'View hidden stories' : 'Browse headlines'; action = hiddenSaves ? hidden : browse;
  } else if (tab.mode === 'saved' && (query.trim() || kind || unread || tab.topic)) {
    title = 'No saved stories match these filters'; body = 'Your saved stories are still in this profile. Clear the filters to see them.'; label = 'Clear filters'; action = clear;
  } else if (query.trim() || kind || tab.topic) {
    title = query.trim() ? 'No cached matches' : 'No stories match these filters'; body = 'Try a broader view of your cached stories.';
    label = query.trim() && !kind && !unread && !tab.topic ? 'Clear search' : 'Clear filters'; action = clear;
  } else if (data.articles.length > 0 && data.articles.every(a => a.hidden)) {
    title = 'Your stories are hidden'; body = 'The stories in this view are hidden, not deleted. Restore retained stories from this reading profile.'; label = 'View hidden stories'; action = hidden;
  } else if (!data.articles.some(a => !a.hidden)) {
    const enabled = data.sources.some(source => source.enabled);
    if (data.sources.some(source => sourceFailed(source) && source.lastSuccess == null))
      return <div className="empty"><h3>Enabled sources have not retrieved stories</h3><p>Some enabled sources failed before their first successful retrieval. Review their health and eligibility before refreshing. Your existing cache is unchanged.</p><button onClick={sources}>Review source failures</button><button onClick={refresh}>Refresh feeds</button></div>;
    title = enabled ? 'Your cache is empty' : 'No sources enabled';
    body = enabled ? 'Refresh enabled feeds to start reading. Source access and available excerpts may vary.' : 'Enable a permitted source to start collecting stories.';
    label = enabled ? 'Refresh feeds' : 'Manage sources'; action = enabled ? refresh : sources;
  } else if (unread || tab.mode === 'brief') {
    title = 'You’re caught up'; body = tab.mode === 'brief' ? 'No new cached stories since your previous visit.' : 'There are no unread stories in this view.'; label = 'Show all stories'; action = browse;
  } else if (tab.mode === 'watchlist') {
    title = 'No stories match this watchlist'; body = 'Adjust its keywords, topics or sources, or browse all headlines.'; label = 'Edit watchlists'; action = watchlists;
  } else {
    title = 'No stories in this view'; body = 'Browse your other cached headlines.'; label = 'Browse headlines'; action = browse;
  }
  return <div className="empty"><h3>{title}</h3><p>{body}</p><button onClick={action}>{label}</button></div>;
}
