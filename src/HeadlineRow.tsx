import { memo } from 'react';
import { Bookmark } from 'lucide-react';
import type { Article } from './types';
import { compactDate, date } from './model';
import StoryThumbnail from './StoryThumbnail';

export default memo(function HeadlineRow({ article: a, selected, related, onSelect, now }: {
  article: Article; profileId: string; selected: boolean; related: number; onSelect: (article: Article) => void;
  now: Date;
}) {
  return <article data-testid="story-row" data-article-id={a.id}
    className={`story-row ${selected ? 'selected' : ''} ${a.read ? 'read' : ''}`}>
    <StoryThumbnail article={a} />
    <div className="row-main">
      <div className="row-meta"><span>{!a.read && <span className="unread-dot" />}{a.sourceName}</span>
        <time title={date(a.publishedAt)} dateTime={a.publishedAt !== null && Number.isFinite(new Date(a.publishedAt * 1000).getTime()) ? new Date(a.publishedAt * 1000).toISOString() : undefined}>{compactDate(a.publishedAt, now)}</time>
      </div>
      <button className="headline" onClick={() => onSelect(a)}>{a.title}</button>
      <div className="row-foot"><span className="capitalize">{a.topics[0] || 'General'}</span>
        {a.sections?.[0] && <span className="tag">{a.sections[0]}</span>}
        {a.kind !== 'reporting' && <span className="tag">{a.kind}</span>}
        {related > 1 && <span>{related} related reports</span>}
        <span className="spacer" />{a.saved && <Bookmark size={13} aria-label="Saved" />}
      </div>
    </div>
  </article>;
});
