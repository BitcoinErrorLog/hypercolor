/**
 * Synchronous in-flight owner for every Connect delegation start
 * (Welcome Connect and Awaiting "Try again").
 */
let owner: number | null = null;
let nextToken = 0;

export function tryBeginConnectDelegation(): number | null {
  if (owner != null) return null;
  nextToken += 1;
  owner = nextToken;
  return owner;
}

export function finishConnectDelegation(token: number): void {
  if (owner === token) {
    owner = null;
  }
}

export function resetConnectDelegationForTests(): void {
  owner = null;
  nextToken = 0;
}
