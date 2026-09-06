import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { color, measure, radius, space, typeRole } from '../theme';
import { EmptyState, SheetChrome } from '../ui/primitives';

export type MessageSearchHit = {
  scope: 'dm' | 'group';
  conversationId: string;
  eventId: string;
  senderPubky: string;
  body: string;
  sentAt: number;
};

export function MessageSearchSheet({
  visible,
  onClose,
  onSearch,
  onOpenHit,
}: {
  visible: boolean;
  onClose: () => void;
  onSearch: (query: string) => Promise<MessageSearchHit[]>;
  onOpenHit: (hit: MessageSearchHit) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MessageSearchHit[] | null>(null);

  return (
    <SheetChrome
      visible={visible}
      title={COPY.messageSearchTitle}
      onClose={onClose}
      testID="messageSearch"
    >
      <TextInput
        testID="messageSearchInput"
        accessibilityLabel={COPY.messageSearchTitle}
        value={query}
        onChangeText={setQuery}
        placeholder={COPY.messageSearchTitle}
        placeholderTextColor={color.textSecondary}
        style={styles.search}
        onSubmitEditing={() => {
          void onSearch(query).then(setHits);
        }}
      />
      <TouchableOpacity
        testID="messageSearchSubmit"
        accessibilityRole="button"
        accessibilityLabel={COPY.messageSearchTitle}
        hitSlop={HIT_SLOP_44}
        onPress={() => {
          void onSearch(query).then(setHits);
        }}
        style={styles.submit}
      >
        <Text style={styles.submitText}>{COPY.messageSearchTitle}</Text>
      </TouchableOpacity>
      {hits && hits.length === 0 ? (
        <EmptyState title={COPY.noSearchHits} testID="messageSearchEmpty" />
      ) : null}
      {hits?.map(hit => (
        <TouchableOpacity
          key={`${hit.scope}:${hit.eventId}`}
          testID={`searchHit-${hit.eventId}`}
          accessibilityRole="button"
          accessibilityLabel={hit.body}
          onPress={() => onOpenHit(hit)}
          style={styles.hit}
        >
          <Text style={styles.hitBody} numberOfLines={2}>
            {hit.body}
          </Text>
          <Text style={styles.hitMeta}>{hit.scope === 'dm' ? 'Chat' : 'Channel'}</Text>
        </TouchableOpacity>
      ))}
    </SheetChrome>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: measure.hitTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.textPrimary,
    marginBottom: space.sm,
  },
  submit: { minHeight: measure.hitTarget, justifyContent: 'center', marginBottom: space.md },
  submitText: { color: color.brandText, fontWeight: '600' },
  hit: {
    minHeight: measure.hitTarget,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  hitBody: { color: color.textPrimary, fontSize: typeRole.body.fontSize },
  hitMeta: { color: color.textMuted, fontSize: typeRole.meta.fontSize },
});
