type WorkspaceChange = "changed" | "replaced";
type Unsubscribe = () => void;

// Each startup attempt owns its listeners, including registration that finishes
// after a retry or unmount. Late registration cannot start a read or report an error.
export function workspaceSubscription(
  subscribe: (changed: (kind: WorkspaceChange) => void) => Promise<Unsubscribe>,
  changed: (kind: WorkspaceChange) => void,
  ready: () => void,
  failed: (error: unknown) => void,
): Unsubscribe {
  let closed = false;
  let stop: Unsubscribe | undefined;
  void subscribe(kind => { if (!closed) changed(kind); })
    .then(unsubscribe => {
      if (closed) unsubscribe();
      else {
        stop = unsubscribe;
        ready();
      }
    })
    .catch(error => { if (!closed) failed(error); });
  return () => {
    if (closed) return;
    closed = true;
    stop?.();
  };
}
