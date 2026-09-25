import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { dispatch, subscribe } from './ipc';

type Preferences = { automatic: boolean; mode: 'visual' | 'compact'; replacementToken: string };
type Session = { profileId: string; replacementToken: string; identity: string; ready: boolean; automatic: boolean; mode: 'visual' | 'compact'; busy: boolean; error: string; update: (automatic: boolean, mode: 'visual' | 'compact') => Promise<void> };
const MediaContext = createContext<Session>({ profileId: '', replacementToken: '', identity: '', ready: false, automatic: false, mode: 'compact', busy: false, error: '', update: async () => {} });
export const useMediaSession = () => useContext(MediaContext);

export function MediaSession({ profileId, replacementToken, children, active }: { profileId: string; replacementToken: string; children: ReactNode; active: boolean }) {
  const [prefs, setPrefs] = useState<Preferences & { profileId: string }>();
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    const stops: (() => void)[] = [];
    const reload = () => {
      const ticket = ++generation.current;
      setPrefs(undefined); setEpoch(v => v + 1);
      void dispatch<Preferences>({ op: 'media_preferences', profileId }).then(value => {
        if (alive && generation.current === ticket && value.replacementToken === replacementToken) setPrefs({ ...value, profileId });
      }).catch(e => { if (alive && generation.current === ticket) setError(String(e)); });
    };
    const install = (stop: () => void) => { if (alive) stops.push(stop); else stop(); };
    window.addEventListener('media-policy-changed', reload);
    if (isTauri()) void listen('media-policy-changed', reload).then(install);
    void subscribe(kind => { if (kind === 'replaced') reload(); }).then(install);
    reload();
    return () => { alive = false; ++generation.current; window.removeEventListener('media-policy-changed', reload); stops.forEach(stop => stop()); };
  }, [profileId, replacementToken]);
  const update = async (automatic: boolean, mode: 'visual' | 'compact') => {
    const ticket = ++generation.current;
    setBusy(true); setError(''); setPrefs(undefined); setEpoch(v => v + 1);
    try {
      await dispatch({ op: 'media_preferences_set', profileId, replacementToken, automatic, mode });
      const value = await dispatch<Preferences>({ op: 'media_preferences', profileId });
      if (ticket === generation.current && value.replacementToken === replacementToken) setPrefs({ ...value, profileId });
    } catch (e) { if (ticket === generation.current) setError(String(e)); }
    finally { setBusy(false); }
  };
  // Invalidate media synchronously on scope changes without remounting the app.
  const currentPrefs = prefs?.profileId === profileId && prefs.replacementToken === replacementToken ? prefs : undefined;
  return <MediaContext.Provider value={{ profileId, replacementToken, identity: `${profileId}:${replacementToken}:${epoch}`, ready: active && !!currentPrefs, automatic: active && !!currentPrefs?.automatic, mode: currentPrefs?.mode || 'visual', busy, error, update }}>{children}</MediaContext.Provider>;
}

export function ImageControls({ settings = false }: { settings?: boolean }) {
  const session = useMediaSession();
  return <section className="image-controls" aria-label={settings ? 'Image preferences' : 'Headline images'}>
    <div className="image-mode" aria-label="Headline display mode">
      <button type="button" disabled={session.busy || !session.ready} aria-pressed={session.mode === 'visual'} onClick={() => void session.update(session.automatic, 'visual')}>Visual</button>
      <button type="button" disabled={session.busy || !session.ready} aria-pressed={session.mode === 'compact'} onClick={() => void session.update(session.automatic, 'compact')}>Compact</button>
    </div>
    {session.automatic ? <button type="button" disabled={session.busy} onClick={() => void session.update(false, session.mode)}>Disable automatic images</button> : <>
      <span className="fine">For personal, noncommercial reading. Automatic images contact publishers and disclose your IP address as you scroll. Only permitted images; no disk cache. Consent is per profile and resets on import.</span>
      <button type="button" disabled={session.busy || !session.ready} onClick={() => void session.update(true, 'visual')}>Enable automatic images</button>
    </>}
    {session.error && <span role="alert">{session.error}</span>}
  </section>;
}
