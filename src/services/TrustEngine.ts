import { StorageService } from './StorageService';
import type { Contact, PubkyKey } from '../types';

/**
 * TrustEngine — soft trust score computation for v1.
 *
 * Trust scores are in [0.0, 1.0]. They are used ONLY for:
 *   - Sorting contacts and channels in the UI (higher trust → higher in list)
 *   - Connection request priority when BLE queue is full
 *
 * Trust scores NEVER block message delivery in v1. The system fails open.
 * The WoT inbound gate does NOT read this composite score (see wotGate.ts).
 *
 * Score components (all additive, each capped):
 *   - Routed link_messages count for (owner, peer): up to 0.40 points
 *   - Recency from lastInteractionAt only (0 if never interacted): up to 0.25
 *   - Social graph:             up to 0.25 points (mutual 0.25 / following 0.15 / follower 0.05)
 *   - Pubky-verified:           0.10 points (contact has a homeserver resolved via PKDNS)
 *
 * Scores are recomputed lazily (on read) and persisted to SQLite.
 */

/** Reason codes surfaced in the debug UI. */
export interface TrustExplanation {
  score: number;
  reasons: Array<{ code: string; contribution: number; label: string }>;
}

const INTERACTION_PER_MESSAGE = 0.01;
const INTERACTION_CAP = 0.4;
const RECENCY_CAP = 0.25;
const RECENCY_WINDOW_DAYS = 30;

export const TrustEngine = {
  /**
   * Returns a full trust explanation for a contact, recomputing the score.
   * Persists the updated score to SQLite.
   */
  async explain(pubky: PubkyKey, ownerPubky?: PubkyKey): Promise<TrustExplanation> {
    const contact = await StorageService.getContact(pubky, ownerPubky);
    if (!contact) {
      return { score: 0, reasons: [] };
    }

    const reasons: TrustExplanation['reasons'] = [];
    const owner = ownerPubky && ownerPubky !== '' ? ownerPubky : contact.ownerPubky;

    // ── Interaction count ────────────────────────────────────────────────────
    // Real routed messages only — never the persisted trustScore (that was a
    // self-recursive feedback loop converging toward the WoT threshold).
    const messageCount =
      owner !== '' ? await StorageService.countLinkMessagesForPeer(owner, pubky) : 0;
    const interactionScore = Math.min(messageCount * INTERACTION_PER_MESSAGE, INTERACTION_CAP);
    if (interactionScore > 0) {
      reasons.push({
        code: 'interactions',
        contribution: parseFloat(interactionScore.toFixed(3)),
        label: 'Interaction history',
      });
    }

    // ── Recency ──────────────────────────────────────────────────────────────
    // lastInteractionAt is written only on a real routed message (or an
    // explicit touch). firstSeenAt is discovery, not interaction.
    const lastInteraction = contact.lastInteractionAt;
    let recencyScore = 0;
    if (lastInteraction !== undefined) {
      const daysSinceLastInteraction = (Date.now() - lastInteraction) / (1000 * 60 * 60 * 24);
      recencyScore = Math.max(
        0,
        RECENCY_CAP * (1 - daysSinceLastInteraction / RECENCY_WINDOW_DAYS),
      );
    }
    if (recencyScore > 0.005) {
      reasons.push({
        code: 'recency',
        contribution: parseFloat(recencyScore.toFixed(3)),
        label: 'Recent interaction',
      });
    }

    // ── Pubky-verified homeserver ────────────────────────────────────────────
    const homeserverScore = contact.homeserver ? 0.1 : 0;
    if (homeserverScore > 0) {
      reasons.push({
        code: 'homeserver_resolved',
        contribution: homeserverScore,
        label: 'Homeserver resolved via PKDNS',
      });
    }

    // ── Social-graph component (max 0.25) ───────────────────────────────────
    // Never blocks delivery. Used for sort order only — not the WoT gate.
    const social = socialGraphScore(contact);
    if (social.score > 0) {
      reasons.push({
        code: social.code,
        contribution: social.score,
        label: social.label,
      });
    }
    const mutualScore = social.score;

    const total = parseFloat(
      Math.min(interactionScore + recencyScore + homeserverScore + mutualScore, 1.0).toFixed(3),
    );

    await StorageService.upsertContact({ ...contact, trustScore: total });

    return { score: total, reasons };
  },

  /**
   * Returns just the score for a contact (fast path, no explanation).
   */
  async getScore(pubky: PubkyKey, ownerPubky?: PubkyKey): Promise<number> {
    const contact = await StorageService.getContact(pubky, ownerPubky);
    return contact?.trustScore ?? 0;
  },

  /**
   * Records a real interaction by updating lastInteractionAt. Does not
   * increment the persisted trustScore — explain() derives that from
   * routed message count.
   */
  async recordInteraction(pubky: PubkyKey, ownerPubky?: PubkyKey): Promise<void> {
    await StorageService.touchContactInteraction(pubky, ownerPubky);
  },

  /**
   * Sorts a list of pubky keys by trust score, descending.
   */
  async sortByTrust(pubkyKeys: PubkyKey[], ownerPubky?: PubkyKey): Promise<PubkyKey[]> {
    const scores = await Promise.all(
      pubkyKeys.map(async p => ({ pubky: p, score: await TrustEngine.getScore(p, ownerPubky) })),
    );
    return scores.sort((a, b) => b.score - a.score).map(s => s.pubky);
  },
};

function socialGraphScore(contact: Contact): { score: number; code: string; label: string } {
  if (contact.isMutual) {
    return { score: 0.25, code: 'mutual', label: 'Mutual follow' };
  }
  if (contact.isFollowing) {
    return { score: 0.15, code: 'following', label: 'You follow them' };
  }
  if (contact.isFollower) {
    return { score: 0.05, code: 'follower', label: 'They follow you' };
  }
  return { score: 0, code: 'none', label: 'No relationship' };
}
