import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space, typeRole } from '../../theme';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export type MessageBubbleProps = {
  children: React.ReactNode;
  mine: boolean;
  time: string;
  status?: string | null;
  failed?: boolean;
  grouped?: boolean;
  showIncomingAvatar?: boolean;
  senderName?: string | null;
  senderPubky?: string | null;
  testID?: string;
};

export function MessageBubble({
  children,
  mine,
  time,
  status = null,
  failed = false,
  grouped = false,
  showIncomingAvatar = false,
  senderName = null,
  senderPubky = null,
  testID,
}: MessageBubbleProps) {
  return (
    <View
      style={[
        styles.wrap,
        mine ? styles.wrapMine : styles.wrapTheirs,
        grouped ? styles.groupedWrap : null,
      ]}
    >
      {!mine && showIncomingAvatar ? (
        <Avatar
          name={senderName}
          pubky={senderPubky}
          size="sm"
          {...(testID ? { testID: `${testID}Avatar` } : {})}
        />
      ) : !mine ? (
        <View style={styles.avatarSpacer} />
      ) : null}
      <View
        {...(testID ? { testID } : {})}
        style={[styles.bubble, mine ? styles.mine : styles.theirs, grouped ? styles.grouped : null]}
      >
        {children}
        <View style={styles.meta}>
          <Text style={[styles.time, mine ? styles.mineMeta : styles.theirsMeta]}>{time}</Text>
          {mine && status ? (
            <>
              <Icon
                name="checkmark-done"
                size={typeRole.meta.fontSize}
                tone={failed ? 'danger' : 'onBrand'}
              />
              <Text style={[styles.status, failed ? styles.failed : null]}>{status}</Text>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    marginVertical: space.xs,
  },
  groupedWrap: {
    marginVertical: space.none,
  },
  wrapMine: {
    justifyContent: 'flex-end',
  },
  wrapTheirs: {
    justifyContent: 'flex-start',
  },
  avatarSpacer: {
    width: 32,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  grouped: {
    marginTop: space.none,
  },
  mine: {
    backgroundColor: color.brand,
    borderBottomRightRadius: radius.bubbleTail,
  },
  theirs: {
    backgroundColor: color.bubbleIncoming,
    borderBottomLeftRadius: radius.bubbleTail,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.xs,
    marginTop: space.xs,
  },
  time: {
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
  status: {
    color: color.onBrandMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
  mineMeta: {
    color: color.onBrandMuted,
  },
  theirsMeta: {
    color: color.textMuted,
  },
  failed: {
    color: color.danger,
  },
});
