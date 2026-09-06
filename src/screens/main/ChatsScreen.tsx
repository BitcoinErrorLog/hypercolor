import React, { useCallback, useEffect, useState } from 'react';
import { Share } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, RootStackParamList } from '../../types';
import type { LinkConversationSummary } from '../../types/link';
import { threadRouteParams } from '../../types/link';
import { StorageService } from '../../services/StorageService';
import { LinkService } from '../../services/link/LinkService';
import { useAuthStore } from '../../stores/authStore';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import { COPY } from '../../copy/uxCopy';
import { copyText } from '../../utils/copyText';
import {
  filterConversationsByPrefs,
  filterDmConversations,
  type ChatListFilter,
} from '../../ui/chatList';
import { ChatsScreenContent } from './ChatsScreenContent';
import { MessageSearchSheet } from '../../components/MessageSearchSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ChatsScreen() {
  const nav = useNavigation<Nav>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const sessionKind = useSessionStatusStore(s => s.kind);
  const pendingRequests = useSessionStatusStore(s => s.pendingRequestCount);
  const setPendingRequestCount = useSessionStatusStore(s => s.setPendingRequestCount);
  const [conversations, setConversations] = useState<LinkConversationSummary[]>([]);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [prefs, setPrefs] = useState<Record<string, { muted: boolean; archived: boolean }>>({});
  const [listFilter, setListFilter] = useState<ChatListFilter>('inbox');
  const [searchOpen, setSearchOpen] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    if (!ownerPubky) {
      setConversations([]);
      setPendingRequestCount(0);
      return;
    }
    try {
      const [rows, pending, people, nicks, threadPrefs] = await Promise.all([
        StorageService.listLinkConversations(ownerPubky),
        StorageService.countPendingMessageRequests(ownerPubky),
        StorageService.getAllContacts(ownerPubky),
        StorageService.getNicknamesForOwner(ownerPubky),
        StorageService.listThreadLocalPrefs(ownerPubky),
      ]);
      setConversations(filterDmConversations(rows));
      setPendingRequestCount(pending);
      const map: Record<string, Contact> = {};
      for (const person of people) map[person.pubky] = person;
      setContacts(map);
      setNicknames(nicks);
      setPrefs(threadPrefs);
      setListError(null);
    } catch {
      setListError(COPY.couldNotLoadChats);
    }
  }, [ownerPubky, setPendingRequestCount]);

  const refresh = useCallback(async () => {
    if (ownerPubky && LinkService.hasSession()) {
      try {
        await LinkService.syncInbox();
      } catch {
        // Local conversation list still refreshes below.
      }
    }
    await loadLocal();
  }, [loadLocal, ownerPubky]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    return LinkService.subscribeInboxSynced(owner => {
      if (owner === ownerPubky) void loadLocal();
    });
  }, [loadLocal, ownerPubky]);

  const handlePress = useCallback(
    (row: LinkConversationSummary) => {
      nav.navigate('Thread', threadRouteParams(row.participantPubky));
    },
    [nav],
  );

  const needsEnable = sessionKind === 'needs-enable' || sessionKind === 'revoked';
  const showEnableCta = needsEnable || sessionKind === 'unavailable';

  const visible = filterConversationsByPrefs(conversations, prefs, listFilter);

  return (
    <>
      <ChatsScreenContent
        conversations={visible}
        contacts={contacts}
        nicknames={nicknames}
        listFilter={listFilter}
        onChangeFilter={setListFilter}
        onOpenSearch={() => setSearchOpen(true)}
        pendingRequests={pendingRequests}
        ownerPubky={ownerPubky}
        needsEnable={needsEnable}
        showEnableCta={showEnableCta}
        listError={listError}
        onOpenThread={handlePress}
        onOpenRequests={() => nav.navigate('MessageRequests')}
        onNewChat={() => nav.navigate('ContactSearch')}
        onEnableMessaging={() => nav.navigate('EnableMessaging')}
        onRetry={() => {
          void refresh();
        }}
        onCopyMyPubky={() => {
          if (ownerPubky) copyText(ownerPubky);
        }}
        onShareMyPubky={() => {
          if (ownerPubky) void Share.share({ message: ownerPubky });
        }}
      />
      <MessageSearchSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={async query => {
          if (!ownerPubky) return [];
          return StorageService.searchDecryptedMessages(ownerPubky, query);
        }}
        onOpenHit={hit => {
          setSearchOpen(false);
          if (hit.scope === 'dm') {
            const peer = hit.conversationId.startsWith('dm:')
              ? hit.conversationId.slice(3)
              : hit.conversationId;
            nav.navigate('Thread', threadRouteParams(peer));
            return;
          }
          nav.navigate('ChannelScreen', { channelId: hit.conversationId });
        }}
      />
    </>
  );
}
