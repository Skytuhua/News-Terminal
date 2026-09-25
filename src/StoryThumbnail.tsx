import { useEffect, useRef, useState } from 'react';
import { Image } from 'lucide-react';
import type { Article, MediaRef, MediaResult } from './types';
import { useMediaSession } from './MediaSession';
import { loadMedia } from './mediaLoader';

export function usePermittedMedia(articleId: string, media: MediaRef, index: number, manual: boolean, attempt = 0) {
  const session = useMediaSession();
  const element = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [state, setState] = useState<{ key: string; result?: MediaResult; error?: string; busy?: boolean }>({ key: '' });
  const key = `${session.identity}:${articleId}:${index}:${JSON.stringify(media)}:${manual}:${attempt}`;
  const enabled = session.ready && media.playback === 'inline' && (manual || (session.automatic && session.mode === 'visual' && media.kind === 'image'));
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), { root: node.closest('.story-list, .detail-body'), rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!enabled || !near) { setState({ key }); return; }
    let current = true;
    setState({ key, busy: true });
    const task = loadMedia({ op: 'media_load', profileId: session.profileId, replacementToken: session.replacementToken, articleId, index, automatic: !manual });
    void task.promise.then(result => { if (result.kind !== media.kind) throw new Error("Unexpected media kind. Open original instead."); if (current) setState({ key, result }); }).catch(e => { if (current) setState({ key, error: String(e) }); });
    return () => { current = false; task.cancel(); };
  }, [key, enabled, near, session.profileId, session.replacementToken, articleId, index, manual]);
  const current = enabled && near && state.key === key ? state : { key };
  return { ...current, element, fail: () => setState({ key, error: 'Image unavailable. Open original instead.' }) };
}
function Thumbnail({ article, media, index }: { article: Article; media: MediaRef; index: number }) {
  const state = usePermittedMedia(article.id, media, index, false);
  const session = useMediaSession();
  return <figure className="row-thumbnail" aria-label="Story image">
    <div className="thumbnail-frame" ref={state.element}>
      {state.result ? <img src={state.result.dataUrl} alt={media.caption || 'Publisher-supplied story image'} onError={state.fail} /> : <div className="thumbnail-placeholder"><Image size={20} /><span>{state.busy ? 'Loading image' : state.error ? 'Image unavailable' : session.automatic ? 'Publisher image' : 'Images paused'}</span></div>}
    </div>
    {media.credit && <figcaption title={media.credit}>Credit: {media.credit}</figcaption>}
    {state.error && <span className="thumbnail-error">Open story for original</span>}
  </figure>;
}
export default function StoryThumbnail({ article }: { article: Article }) {
  const session = useMediaSession();
  const index = article.media?.findIndex(item => item.kind === 'image' && item.playback === 'inline') ?? -1;
  if (session.mode === 'compact' || index < 0) return null;
  return <Thumbnail key={`${session.identity}:${article.id}:${article.updatedAt}:${JSON.stringify(article.media![index])}`} article={article} media={article.media![index]} index={index} />;
}
