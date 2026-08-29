import { StorageService } from './StorageService';
import type { PubkyKey } from '../types';

/**
 * TrustEngine — soft trust score computation for v1.
 *
 * Trust scores are in [0.0, 1.0]. They are used ONLY for:
 *   - Sorting contacts and channels in the UI (higher trust → higher in list)
 *   - Connection request priority when BLE queue is full
 *
 * Trust scores NEVER block message delivery in v1. The system fails open.
 *
 * Score components (all additive, each capped):
 *   - Local interaction count:  up to 0.40 points
 *   - Recency:                  up to 0.25 points
 *   - Mutual contacts:          up to 0.25 points (placeholder — not yet computed)
 *   - Pubky-verified:           0.10 points (contact has a homeserver resolved via PKDNS)
 *
 * Scores are recomputed lazily (on read) and persisted to SQLite.
 */

/** Reason codes surfaced in the debug UI. */
export interface TrustExplanation {
  score: number;
  reasons: Array<{ code: string; contribution: number; label: string }>;
}

export const TrustEngine = {
  /**
   * Returns a full trust explanation for a contact, recomputing the score.
   * Persists the updated score to SQLite.
   */
  async explain(pubky: PubkyKey): Promise<TrustExplanation> {
    const contact = await StorageService.getContact(pubky);
    if (!contact) {
      return { score: 0, reasons: [] };
    }

    const reasons: TrustExplanation['reasons'] = [];

    // ── Interaction count ────────────────────────────────────────────────────
    // Each interaction (sent or received message) contributes.
    // We approximate interaction count from trust_score history — in a future
    // version this will query a dedicated interactions table.
    const interactionScore = Math.min(contact.trustScore * 0.4, 0.4);
    if (interactionScore > 0) {
      reasons.push({
        code: 'interactions',
        contribution: parseFloat(interactionScore.toFixed(3)),
        label: 'Interaction history',
      });
    }

    // ── Recency ──────────────────────────────────────────────────────────────
    const lastSeen = contact.lastInteractionAt ?? contact.firstSeenAt;
    const daysSinceLastInteraction = (Date.now() - lastSeen) / (1000 * 60 * 60 * 24);
    // Decays from 0.25 → 0 over 30 days since last interaction
    const recencyScore = Math.max(0, 0.25 * (1 - daysSinceLastInteraction / 30));
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

    // ── Mutual contacts placeholder ──────────────────────────────────────────
    // Future: query shared contacts and compute overlap score (max 0.25).
    // For v1 this is always 0 to avoid false inflation.
    const mutualScore = 0;

    const total = parseFloat(
      Math.min(interactionScore + recencyScore + homeserverScore + mutualScore, 1.0).toFixed(3),
    );

    // Persist updated score
    await StorageService.upsertContact({ ...contact, trustScore: total });

    return { score: total, reasons };
  },

  /**
   * Returns just the score for a contact (fast path, no explanation).
   */
  async getScore(pubky: PubkyKey): Promise<number> {
    const contact = await StorageService.getContact(pubky);
    return contact?.trustScore ?? 0;
  },

  /**
   * Increments trust after a positive interaction (sent/received message).
   * Delta is small so scores change gradually.
   */
  async recordInteraction(pubky: PubkyKey): Promise<void> {
    // Each interaction adds 0.01 to trust score, capped at 0.40
    await StorageService.updateTrustScore(pubky, 0.01);
  },

  /**
   * Sorts a list of pubky keys by trust score, descending.
   */
  async sortByTrust(pubkyKeys: PubkyKey[]): Promise<PubkyKey[]> {
    const scores = await Promise.all(
      pubkyKeys.map(async p => ({ pubky: p, score: await TrustEngine.getScore(p) })),
    );
    return scores.sort((a, b) => b.score - a.score).map(s => s.pubky);
  },
};
