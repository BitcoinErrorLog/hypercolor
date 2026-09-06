import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { color, measure, radius, space, typeRole } from '../theme';
import { EmptyState, SheetChrome } from '../ui/primitives';
import { searchGifs, type GifProxyHit, type GifSearchResult } from '../services/gif/GifProxyClient';

export function GifPickerSheet({
  visible,
  onClose,
  onPick,
  seedResult = null,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (hit: GifProxyHit) => void;
  seedResult?: GifSearchResult | null;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GifSearchResult | null>(seedResult);

  async function runSearch(): Promise<void> {
    setBusy(true);
    const next = await searchGifs(query);
    setResult(next);
    setBusy(false);
  }

  const notConfigured = result?.ok === false && result.reason === 'not-configured';

  return (
    <SheetChrome visible={visible} title={COPY.gifPickerTitle} onClose={onClose} testID="gifPicker">
      <View style={styles.searchRow}>
        <TextInput
          testID="gifSearchInput"
          accessibilityLabel={COPY.gifSearch}
          value={query}
          onChangeText={setQuery}
          placeholder={COPY.gifSearch}
          placeholderTextColor={color.textSecondary}
          style={styles.search}
          onSubmitEditing={() => {
            void runSearch();
          }}
        />
        <TouchableOpacity
          testID="gifSearchSubmit"
          accessibilityRole="button"
          accessibilityLabel={COPY.gifSearch}
          hitSlop={HIT_SLOP_44}
          onPress={() => {
            void runSearch();
          }}
          style={styles.searchBtn}
        >
          <Text style={styles.searchBtnText}>{COPY.gifSearch}</Text>
        </TouchableOpacity>
      </View>
      {busy ? <ActivityIndicator color={color.brand} /> : null}
      {notConfigured ? (
        <EmptyState
          title={COPY.gifNotConfigured}
          body={COPY.gifNotConfiguredBody}
          testID="gifNotConfigured"
        />
      ) : null}
      {result?.ok === false && result.reason === 'error' ? (
        <Text style={styles.error}>{result.message}</Text>
      ) : null}
      {result?.ok ? (
        <ScrollView contentContainerStyle={styles.grid}>
          {result.results.map(hit => (
            <TouchableOpacity
              key={hit.id}
              testID={`gifHit-${hit.id}`}
              accessibilityRole="button"
              accessibilityLabel={`GIF ${hit.id}`}
              onPress={() => onPick(hit)}
              style={styles.hit}
            >
              <Image source={{ uri: hit.preview.url }} style={styles.preview} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </SheetChrome>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  search: {
    flex: 1,
    minHeight: measure.hitTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.textPrimary,
  },
  searchBtn: {
    minHeight: measure.hitTarget,
    minWidth: measure.hitTarget,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  searchBtnText: { color: color.brandText, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hit: {
    width: 104,
    height: 104,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surfaceRaised,
  },
  preview: { width: '100%', height: '100%' },
  error: { color: color.danger, fontSize: typeRole.secondary.fontSize },
});
