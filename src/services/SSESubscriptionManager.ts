import { PubkyService } from './PubkyService';
import { StorageService } from './StorageService';
import type { PubkyKey } from '../types';

/**
 * SSESubscriptionManager — listens for homeserver SSE events and triggers
 * catch-up fetches for new DM envelopes.
 *
 * @synonymdev/react-native-pubky provides a single global event listener
 * (`setEventListener`) that receives all homeserver push events. This manager
 * wraps that listener and dispatches relevant envelope notifications.
 *
 * On reconnect / foreground: call `subscribeToContacts` to run a catch-up
 * pass for all known contacts (fetches any missed envelopes since last cursor).
 */

/** Parsed representation of a homeserver SSE event. */
interface SSEEvent {
  eventType: 'PUT' | 'DELETE';
  path: string;
}

type EnvelopeReceivedCallback = (senderPubky: PubkyKey, envelopeUrl: string) => Promise<void>;

let envelopeCallback: EnvelopeReceivedCallback | null = null;
let listening = false;

export const SSESubscriptionManager = {
  /**
   * Registers the callback that will be called for each received envelope.
   * Must be called before `subscribeToContacts`.
   */
  setEnvelopeCallback(callback: EnvelopeReceivedCallback): void {
    envelopeCallback = callback;
  },

  /**
   * Starts the global SSE listener (if not already started) and runs a
   * catch-up pass for all known contacts.
   * Safe to call on every app foreground / network reconnect.
   */
  async subscribeToContacts(localPubky: PubkyKey): Promise<void> {
    if (!listening) {
      await PubkyService.setEventListener((rawEventData: string) => {
        handleRawEvent(rawEventData, localPubky);
      });
      listening = true;
    }

    const contacts = await StorageService.getAllContacts();
    for (const contact of contacts) {
      try {
        await catchUp(localPubky, contact.pubky);
      } catch {
        // Non-fatal: if one contact's homeserver is down, continue with others
      }
    }
  },

  /**
   * Stops the global SSE listener.
   */
  async unsubscribeAll(): Promise<void> {
    if (listening) {
      await PubkyService.removeEventListener();
      listening = false;
    }
  },

  /**
   * Runs a catch-up fetch for a newly added contact.
   */
  async subscribeToContact(localPubky: PubkyKey, contactPubky: PubkyKey): Promise<void> {
    try {
      await catchUp(localPubky, contactPubky);
    } catch {
      // Non-fatal
    }
  },
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function handleRawEvent(rawEventData: string, localPubky: PubkyKey): void {
  try {
    const event = JSON.parse(rawEventData) as SSEEvent;
    if (event.eventType !== 'PUT') return;

    // Match paths of the form: pubky://{sender}/pub/hypercolor.app/v1/outbox/{localPubky}/{cursor}.bin
    const outboxPattern = new RegExp(
      `pubky://([^/]+)/pub/hypercolor\\.app/v1/outbox/${localPubky}/`,
    );
    const match = event.path.match(outboxPattern);
    if (!match || !match[1]) return;

    const senderPubky = match[1] as PubkyKey;
    envelopeCallback?.(senderPubky, event.path).catch(() => {
      /* non-critical */
    });
  } catch {
    // Malformed event — ignore
  }
}

async function catchUp(localPubky: PubkyKey, contactPubky: PubkyKey): Promise<void> {
  const lastCursor = await StorageService.getCursor(contactPubky, localPubky, 'dm');
  const urls = await PubkyService.listOutboxAfter(contactPubky, localPubky, lastCursor);
  for (const url of urls) {
    await envelopeCallback?.(contactPubky, url);
  }
}
