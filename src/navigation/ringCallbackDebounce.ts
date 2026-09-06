const DEBOUNCE_MS = 30_000;
const seen = new Map<string, number>();
const inFlight = new Set<string>();

function prune(now: number): void {
  for (const [id, at] of seen) {
    if (now - at > DEBOUNCE_MS) seen.delete(id);
  }
}

/** Returns true when this request_id should run handleRingCallback. */
export function consumeRingCallbackRequestId(requestId: string, now: number = Date.now()): boolean {
  if (!requestId) return true;
  prune(now);
  if (inFlight.has(requestId)) return false;
  const previous = seen.get(requestId);
  if (previous != null && now - previous <= DEBOUNCE_MS) {
    return false;
  }
  inFlight.add(requestId);
  return true;
}

/**
 * Release the in-flight guard. A successful handler stays in the 30s replay
 * window; a rejection is evicted so a legitimate retry of the same callback
 * can run.
 */
export function completeRingCallbackRequestId(
  requestId: string,
  succeeded: boolean,
  now: number = Date.now(),
): void {
  if (!requestId) return;
  inFlight.delete(requestId);
  if (succeeded) {
    seen.set(requestId, now);
  } else {
    seen.delete(requestId);
  }
}

export function resetRingCallbackDebounceForTests(): void {
  seen.clear();
  inFlight.clear();
}

export function ringCallbackRequestIdFromUrl(url: string): string | null {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return null;
  const query = url.slice(qIndex + 1);
  const hash = query.indexOf('#');
  const q = hash >= 0 ? query.slice(0, hash) : query;
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? decodeURIComponent(part) : decodeURIComponent(part.slice(0, eq));
    if (key !== 'request_id') continue;
    const value = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1));
    return value.length > 0 ? value : null;
  }
  return null;
}
