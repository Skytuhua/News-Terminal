export function invokeNative(page, request) {
  return page.evaluate(async request => {
    const invoke = request => window.__TAURI_INTERNALS__.invoke('dispatch', { request });
    if (['profile_update', 'profile_reset', 'profile_create', 'watchlist_save', 'watchlist_delete',
      'source_add', 'source_update', 'provider_save', 'local_ai_connect'].includes(request.op)
      && !Object.hasOwn(request, 'replacementToken')) {
      const workspace = await invoke({ op: 'workspace_get', profileId: 'default' });
      request = { ...request, replacementToken: workspace.replacementToken };
    }
    return invoke(request);
  }, request);
}
