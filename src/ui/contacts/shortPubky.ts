import { PUBKY_ID_LENGTH } from '../../utils/pubkyId';

export { shortPubky } from '../shortPubky';

/** Deliberately grouped identifier for accessibility names — not a raw 52-char run. */
export function groupedPubky(pubky: string): string {
  const key = pubky.length === PUBKY_ID_LENGTH ? pubky : pubky.slice(0, PUBKY_ID_LENGTH);
  const head = `${key.slice(0, 4)} ${key.slice(4, 8)}`;
  const tail = key.slice(-4);
  return `${head} … ${tail}`;
}

export function contactRowAccessLabel(args: {
  addedManually: boolean;
  displayName: string | undefined;
  pubky: string;
  primary: string;
  secondary: string | null;
}): string {
  const identifier = groupedPubky(args.pubky);
  if (!args.addedManually) {
    const claim = args.secondary ? `, ${args.secondary}` : '';
    return `Open suggestion ${args.primary}${claim}, identifier ${identifier}`;
  }
  return `Open contact ${args.primary}, identifier ${identifier}`;
}
