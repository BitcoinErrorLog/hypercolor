/**
 * Synchronous in-flight owner for every Connect delegation start
 * (Welcome Connect and Awaiting "Try again").
 */
let inFlight = false;

export function tryBeginConnectDelegation(): boolean {
  if (inFlight) return false;
  inFlight = true;
  return true;
}

export function finishConnectDelegation(): void {
  inFlight = false;
}
