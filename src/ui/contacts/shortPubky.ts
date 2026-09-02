import { PUBKY_ID_LENGTH } from '../../utils/pubkyId';

/** Visual abbreviation for a z32 pubky. Accessible name should use {@link groupedPubky}. */
export function shortPubky(pubky: string): string {
  if (pubky.length <= 12) return pubky;
  return `${pubky.slice(0, 6)}…${pubky.slice(-4)}`;
}

/** Deliberately grouped identifier for accessibility names — not a raw 52-char run. */
export function groupedPubky(pubky: string): string {
  const key = pubky.length === PUBKY_ID_LENGTH ? pubky : pubky.slice(0, PUBKY_ID_LENGTH);
  const head = `${key.slice(0, 4)} ${key.slice(4, 8)}`;
  const tail = key.slice(-4);
  return `${head} … ${tail}`;
}

export function contactRowAccessLabel(displayName: string | undefined, pubky: string): string {
  const identity = displayName && displayName.length > 0 ? displayName : shortPubky(pubky);
  return `Open contact ${identity}, identifier ${groupedPubky(pubky)}`;
}
