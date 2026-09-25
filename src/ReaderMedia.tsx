import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Article, MediaRef } from './types';
import { dispatch } from './ipc';
import { usePermittedMedia } from './StoryThumbnail';
import { useMediaSession } from './MediaSession';

function MediaSlot({ articleId, media, index }: { articleId: string; media: MediaRef; index: number }) {
  const [attempt, setAttempt] = useState(0);
  const [openError, setOpenError] = useState('');
  const session = useMediaSession();
  const state = usePermittedMedia(articleId, media, index, attempt > 0, attempt);
  const automatic = session.automatic && session.mode === 'visual' && media.kind === 'image';
  return <figure className="media-slot">
    <div className="media-label"><span>{media.kind === 'image' ? 'Image' : 'Video'} {index + 1}</span><span className="spacer" /><span>{state.busy ? 'Loading…' : state.error ? 'Media unavailable' : state.result ? 'Loaded' : media.playback === 'external' ? 'Original only' : automatic ? 'Automatic image' : 'Click to load'}</span></div>
    <div ref={state.element} className="reader-media-frame">
      {state.result && (state.result.kind === 'image'
        ? <img src={state.result.dataUrl} alt={media.caption || 'Publisher-supplied image'} onError={state.fail} />
        : <video src={state.result.dataUrl} controls preload="none" aria-label={media.caption || 'Publisher-supplied video'} onError={state.fail} />)}
    </div>
    <figcaption>{media.caption && <p>{media.caption}</p>}{media.credit && <p className="fine">Credit: {media.credit}</p>}</figcaption>
    {(state.error || openError) && <p className="form-error" role="alert">{state.error || openError}</p>}
    <div className="form-actions">
      {media.playback === 'inline' && !automatic && !state.result && <button disabled={state.busy || !session.ready} aria-label={`Load ${media.kind} ${index + 1}`} onClick={() => setAttempt(value => value + 1)}>{state.busy ? 'Loading media…' : `Load ${media.kind}`}</button>}
      <button className="quiet" aria-label={`Open media original ${index + 1}`} onClick={() => void dispatch({ op: 'open_original', url: media.url }).catch(e => setOpenError(String(e)))}>Open original <ExternalLink size={13} /></button>
    </div>
  </figure>;
}
export default function ReaderMedia({ article }: { article: Article; profileId: string }) {
  const session = useMediaSession();
  if (!article.media?.length) return null;
  return <section className="reader-media"><h3>Publisher media</h3><p className="fine">{session.automatic && session.mode === 'visual' ? 'Permitted images load near the viewport.' : 'Images are paused; you can load individual media here.'} Loading contacts the media host and discloses your IP address. Video never autoplays. Images are bounded static previews, not original-resolution downloads.</p>
    {article.media.map((media, index) => <MediaSlot key={`${session.identity}:${article.id}:${article.updatedAt}:${index}:${JSON.stringify(media)}`} articleId={article.id} media={media} index={index} />)}
  </section>;
}
