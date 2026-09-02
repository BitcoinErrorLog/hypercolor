import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Contact, MeshPeer, PubkyKey } from '../types';
import { useAuthStore } from './authStore';
import { FollowsImportSettings } from '../services/contacts/followsImportSettings';
import {
  canUpsertOwnedContact,
  replaceOwnerContactMap,
} from '../services/contacts/contactOwnerScope';

interface ContactState {
  ownerPubky: PubkyKey | null;
  contacts: Record<PubkyKey, Contact>;
  meshPeers: Record<string, MeshPeer>; // keyed by pubkyHash
  /** Pubky to show on Contact detail after add-contact or row tap. */
  detailPubky: PubkyKey | null;

  upsertContact: (contact: Contact) => void;
  removeContact: (pubky: PubkyKey) => void;
  replaceContacts: (ownerPubky: PubkyKey, rows: Contact[]) => void;
  reset: () => void;
  upsertMeshPeer: (peer: MeshPeer) => void;
  removeMeshPeer: (pubkyHash: string) => void;
  updateTrustScore: (pubky: PubkyKey, delta: number) => void;
  openContactDetail: (pubky: PubkyKey) => void;
  closeContactDetail: () => void;
}

function emptyState(): Pick<ContactState, 'ownerPubky' | 'contacts' | 'meshPeers' | 'detailPubky'> {
  return {
    ownerPubky: null,
    contacts: {},
    meshPeers: {},
    detailPubky: null,
  };
}

export const useContactStore = create<ContactState>()(
  immer(set => ({
    ...emptyState(),

    upsertContact: contact =>
      set(state => {
        if (!canUpsertOwnedContact(state.ownerPubky, contact)) return;
        if (!state.ownerPubky) state.ownerPubky = contact.ownerPubky;
        state.contacts[contact.pubky] = contact;
      }),

    removeContact: pubky =>
      set(state => {
        delete state.contacts[pubky];
        if (state.detailPubky === pubky) state.detailPubky = null;
      }),

    replaceContacts: (ownerPubky, rows) =>
      set(state => {
        state.ownerPubky = ownerPubky;
        const next = replaceOwnerContactMap(ownerPubky, rows);
        state.contacts = next;
        if (state.detailPubky && !next[state.detailPubky]) state.detailPubky = null;
      }),

    reset: () =>
      set(state => {
        state.ownerPubky = null;
        state.contacts = {};
        state.meshPeers = {};
        state.detailPubky = null;
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

let previousOwner = useAuthStore.getState().pubky;
useAuthStore.subscribe(state => {
  if (state.pubky === previousOwner) return;
  previousOwner = state.pubky;
  useContactStore.getState().reset();
  FollowsImportSettings.clearSessionMemory();
  if (state.pubky) void FollowsImportSettings.hydrate(state.pubky);
});
