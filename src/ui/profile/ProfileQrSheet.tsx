import React from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { AuthQr } from '../../components/AuthQr';
import { COPY } from '../../copy/uxCopy';
import { color, measure, radius, space, typeRole } from '../../theme';
import { HIT_SLOP_44 } from '../hitTarget';
import { SheetChrome } from '../primitives/SheetChrome';
import { canonicalPubkyUri } from '../../utils/canonicalPubkyUri';
import { parsePubky } from '../../utils/pubkyId';
import { copyText } from '../../utils/copyText';

export function ProfileQrSheet({
  visible,
  pubky,
  copied,
  onCopied,
  onClose,
}: {
  visible: boolean;
  pubky: string;
  copied: boolean;
  onCopied: () => void;
  onClose: () => void;
}): React.ReactElement | null {
  const parsed = parsePubky(pubky);
  if (!parsed) return null;
  const uri = canonicalPubkyUri(parsed);

  return (
    <SheetChrome
      visible={visible}
      title={COPY.yourPubkyQrTitle}
      onClose={onClose}
      closeLabel={COPY.done}
      testID="profileQrSheet"
    >
      <View style={styles.body}>
        <AuthQr value={uri} testID="profileQrCode" accessibilityLabel="Your pubky QR code" />
        <Text testID="mask-pubky" accessibilityLabel="Profile pubky" selectable style={styles.mono}>
          {uri}
        </Text>
        <View style={styles.row}>
          <Pressable
            testID="profileQrCopy"
            accessibilityRole="button"
            accessibilityLabel="Copy pubky"
            hitSlop={HIT_SLOP_44}
            onPress={() => {
              copyText(uri);
              onCopied();
            }}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{copied ? COPY.copied : 'Copy'}</Text>
          </Pressable>
          <Pressable
            testID="profileQrShare"
            accessibilityRole="button"
            accessibilityLabel={COPY.share}
            hitSlop={HIT_SLOP_44}
            onPress={() => {
              void Share.share({ message: uri });
            }}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{COPY.share}</Text>
          </Pressable>
        </View>
      </View>
    </SheetChrome>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    gap: space.lg,
    alignItems: 'center',
  },
  mono: {
    fontSize: typeRole.mono.fontSize,
    lineHeight: typeRole.mono.lineHeight,
    color: color.textSecondary,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: space.xl,
  },
  action: {
    minHeight: measure.hitTarget,
    minWidth: measure.hitTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  actionLabel: {
    color: color.brandText,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
