import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, typeRole } from '../../theme';
import {
  COPY_MESSAGE_A11Y_ACTION,
  TAG_MESSAGE_A11Y_ACTION,
  handleCopyAccessibilityAction,
  presentMessageActionSheet,
} from '../messageCopyActions';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export type MessageBubbleProps = {
  children: React.ReactNode;
  mine: boolean;
  time: string;
  status?: string | null;
  statusTextVisible?: boolean;
  failed?: boolean;
  grouped?: boolean;
  lastInGroup?: boolean;
  showIncomingAvatar?: boolean;
  senderName?: string | null;
  senderPubky?: string | null;
  accessibilityLabel?: string;
  copyBody?: string | null;
  testID?: string;
  footer?: React.ReactNode;
  onTag?: () => void;
  onDelete?: () => void;
};

export function MessageBubble({
  children,
  mine,
  time,
  status = null,
  statusTextVisible = false,
  failed = false,
  grouped = false,
  lastInGroup = true,
  showIncomingAvatar = false,
  senderName = null,
  senderPubky = null,
  accessibilityLabel,
  copyBody = null,
  testID,
  footer = null,
  onTag,
  onDelete,
}: MessageBubbleProps) {
  const copyEnabled = Boolean(copyBody);
  const actionEnabled = copyEnabled || Boolean(onTag) || Boolean(onDelete);
  const bubbleStyle = [
    styles.bubble,
    mine ? styles.mine : styles.theirs,
    lastInGroup && mine ? styles.mineTail : null,
    lastInGroup && !mine ? styles.theirsTail : null,
    grouped ? styles.grouped : null,
  ];
  const a11y = {
    ...(testID ? { testID } : {}),
    ...(accessibilityLabel ? { accessible: true as const, accessibilityLabel } : {}),
    ...(actionEnabled
      ? {
          ...(copyEnabled
            ? {
                accessibilityActions: onTag
                  ? [COPY_MESSAGE_A11Y_ACTION, TAG_MESSAGE_A11Y_ACTION]
                  : [COPY_MESSAGE_A11Y_ACTION],
                onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
                  if (event.nativeEvent.actionName === 'tag') {
                    onTag?.();
                    return;
                  }
                  handleCopyAccessibilityAction(event.nativeEvent.actionName, copyBody ?? '');
                },
              }
            : {}),
          onLongPress: () => presentMessageActionSheet(copyBody ?? '', onTag, onDelete),
        }
      : {}),
  };
  const Bubble = actionEnabled ? Pressable : View;
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
      <Bubble {...a11y} style={bubbleStyle}>
        {children}
        <View style={styles.meta}>
          <Text style={[styles.time, mine ? styles.mineMeta : styles.theirsMeta]}>{time}</Text>
          {mine && status ? (
            <>
              <Icon
                name="checkmark-done"
                size={typeRole.meta.fontSize}
                tone={failed ? 'danger' : 'onBrand'}
                accessibilityLabel={status}
              />
              {failed || statusTextVisible ? (
                <Text style={[styles.status, failed ? styles.failed : null]}>{status}</Text>
              ) : null}
            </>
          ) : null}
        </View>
        {footer}
      </Bubble>
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
  },
  mineTail: {
    borderBottomRightRadius: radius.bubbleTail,
  },
  theirs: {
    backgroundColor: color.bubbleIncoming,
  },
  theirsTail: {
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
    color: color.textPrimary,
  },
});
