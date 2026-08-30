import { WOT_AUTO_ACCEPT_TRUST_THRESHOLD } from '../../flags/config';

/**
 * WoT gate for newly discovered inbound Encrypted Links.
 *
 * This is a REQUEST filter, not a delivery block. Accepted / already-
 * established conversations always receive. Trust scores never block
 * delivery for those peers (see TrustEngine).
 *
 * Policy — auto-accept is driven by relationship bits the local user
 * chose (follow / mutual / manual add) or by a prior *routed*
 * conversation (link_messages rows for this owner+peer). A unilateral
 * follower cannot inflate any of those signals: they cannot set
 * isFollowing / isMutual / addedManually, and they cannot create a
 * routed message row without first passing this gate (or being
 * accepted). The composite TrustEngine score is intentionally NOT an
 * auto-accept input — it includes interaction/recency components that
 * a stranger could previously recurse into the threshold.
 *
 * | isMutual | isFollowing | addedManually | prior routed msgs | decision     |
 * |----------|-------------|---------------|-------------------|--------------|
 * | true     | *           | *             | *                 | auto-accept  |
 * | false    | true        | *             | *                 | auto-accept  |
 * | false    | false       | true          | *                 | auto-accept  |
 * | false    | false       | false         | > 0               | auto-accept  |
 * | false    | false       | false         | 0                 | request      |
 *
 * `addedManually` is the paste/QR add path: the user already chose this
 * pubky as a contact, same intent as following them.
 *
 * `hasEstablishedConversation` is true only when routed `link_messages`
 * already exist for (owner, peer). That is the recovery path after a
 * wedged-link wipe: the conversation is not "new inbound".
 *
 * AppConfig.getWotAutoAcceptTrustThreshold() remains wired so a stored
 * override is read; it is NOT used to auto-accept a never-interacted
 * stranger (the previous 0.5 composite-score path).
 */
export type WotDecision = 'auto-accept' | 'request';

export type WotInput = {
  isMutual: boolean;
  isFollowing: boolean;
  addedManually: boolean;
  hasEstablishedConversation: boolean;
};

export function resolveWotAutoAcceptThreshold(): number {
  try {
    // Lazy so unit tests that import this file do not load react-native-mmkv.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require('../../flags') as {
      AppConfig: { getWotAutoAcceptTrustThreshold: () => number };
    };
    return flags.AppConfig.getWotAutoAcceptTrustThreshold();
  } catch {
    return WOT_AUTO_ACCEPT_TRUST_THRESHOLD;
  }
}

export function classifyInboundPeer(
  input: WotInput,
  threshold: number = resolveWotAutoAcceptThreshold(),
): WotDecision {
  void threshold;
  if (input.isMutual || input.isFollowing || input.addedManually) return 'auto-accept';
  if (input.hasEstablishedConversation) return 'auto-accept';
  return 'request';
}

export function wotInputFromContact(
  contact: {
    isMutual: boolean;
    isFollowing: boolean;
    addedManually: boolean;
  } | null,
  hasEstablishedConversation = false,
): WotInput {
  if (!contact) {
    return {
      isMutual: false,
      isFollowing: false,
      addedManually: false,
      hasEstablishedConversation,
    };
  }
  return {
    isMutual: contact.isMutual,
    isFollowing: contact.isFollowing,
    addedManually: contact.addedManually,
    hasEstablishedConversation,
  };
}
