const listeners = new Set<() => void>();

/** Enable Messaging re-checks `getEnableStatus` when the app becomes active. */
export function subscribeEnableMessagingResume(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyEnableMessagingResume(): void {
  for (const listener of listeners) listener();
}
