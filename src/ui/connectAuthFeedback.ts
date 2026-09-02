export type ConnectAuthFeedback = 'denied' | 'offline';

const listeners = new Set<(next: ConnectAuthFeedback) => void>();

/** Awaiting Ring observes Connect callback failures without owning RootNavigator. */
export function subscribeConnectAuthFeedback(
  listener: (next: ConnectAuthFeedback) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyConnectAuthFeedback(next: ConnectAuthFeedback): void {
  for (const listener of listeners) listener(next);
}
