/** Visual truncation for a 52-character z-base-32 pubky. Never use the full key as a title. */
export function shortPubky(pubky: string): string {
  const value = pubky.trim();
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
