/**
 * Synchronous in-flight owner for every Connect delegation start
 * (Welcome Connect and Awaiting "Try again").
 */
let owner: number | null = null;
let nextToken = 0;
const idleListeners = new Set<() => void>();

export function tryBeginConnectDelegation(): number | null {
  if (owner != null) return null;
  nextToken += 1;
  owner = nextToken;
  return owner;
}

export function isConnectDelegationInFlight(): boolean {
  return owner != null;
}

export function finishConnectDelegation(token: number): void {
  if (owner === token) {
    owner = null;
    notifyConnectDelegationIdle();
  }
}

export function subscribeConnectDelegationIdle(listener: () => void): () => void {
  idleListeners.add(listener);
  return () => {
    idleListeners.delete(listener);
  };
}

function notifyConnectDelegationIdle(): void {
  if (owner != null) return;
  for (const listener of idleListeners) listener();
}

export function resetConnectDelegationForTests(): void {
  if (process.env.NODE_ENV !== 'test' && !(typeof __DEV__ !== 'undefined' && __DEV__)) {
    return;
  }
  owner = null;
  nextToken = 0;
}
