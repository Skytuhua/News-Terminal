import { useMemo, useState } from 'react';

type Widths = { nav: number; detail: number };
const defaults: Widths = {nav:205, detail:390};
function readWidths(key: string): Widths {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value?.version === 1 && typeof value.nav === 'number' && Number.isFinite(value.nav) && value.nav >= 160 && value.nav <= 320
      && typeof value.detail === 'number' && Number.isFinite(value.detail) && value.detail >= 290 && value.detail <= 600) return {nav:value.nav, detail:value.detail};
  } catch { /* Local UI storage may be unavailable. Reading must still work. */ }
  return defaults;
}
export function usePaneWidths(profileId: string, windowLabel: string, tabId: string) {
  const key = `news-terminal:panes:${JSON.stringify([profileId, windowLabel, tabId])}`;
  const restored = useMemo(() => readWidths(key), [key]);
  const [draft, setDraft] = useState({key, widths:restored});
  const widths = draft.key === key ? draft.widths : restored;
  function update(pane: keyof Widths, value: number, commit = false) {
    const next = {...widths, [pane]:value};
    setDraft({key, widths:next});
    if (commit) {
      try { localStorage.setItem(key, JSON.stringify({version:1, ...next})); }
      catch { /* Non-sensitive preferences are best effort, not a workspace failure. */ }
    }
  }
  return { key, widths, update };
}
