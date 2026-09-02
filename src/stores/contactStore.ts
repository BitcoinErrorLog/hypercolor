import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Contact, MeshPeer, PubkyKey } from '../types';

interface ContactState {
  contacts: Record<PubkyKey, Contact>;
  meshPeers: Record<string, MeshPeer>; // keyed by pubkyHash
  /** Pubky to show on Contact detail after add-contact or row tap. */
  detailPubky: PubkyKey | null;

  upsertContact: (contact: Contact) => void;
  removeContact: (pubky: PubkyKey) => void;
  upsertMeshPeer: (peer: MeshPeer) => void;
  removeMeshPeer: (pubkyHash: string) => void;
  updateTrustScore: (pubky: PubkyKey, delta: number) => void;
  openContactDetail: (pubky: PubkyKey) => void;
  closeContactDetail: () => void;
}

export const useContactStore = create<ContactState>()(
  immer(set => ({
    contacts: {},
    meshPeers: {},
    detailPubky: null,

    upsertContact: contact =>
      set(state => {
        state.contacts[contact.pubky] = contact;
      }),

    removeContact: pubky =>
      set(state => {
        delete state.contacts[pubky];
        if (state.detailPubky === pubky) state.detailPubky = null;
      }),

    upsertMeshPeer: peer =>
      set(state => {
        state.meshPeers[peer.pubkyHash] = peer;
      }),

    removeMeshPeer: pubkyHash =>
      set(state => {
        delete state.meshPeers[pubkyHash];
      }),

    updateTrustScore: (pubky, delta) =>
      set(state => {
        const contact = state.contacts[pubky];
        if (contact) {
          contact.trustScore = Math.max(0, Math.min(100, contact.trustScore + delta));
          contact.lastInteractionAt = Date.now();
        }
      }),

    openContactDetail: pubky =>
      set(state => {
        state.detailPubky = pubky;
      }),

    closeContactDetail: () =>
      set(state => {
        state.detailPubky = null;
      }),
  })),
);
