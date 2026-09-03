import React from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import {
  Avatar,
  Button,
  DetailRow,
  EmptyState,
  ListRow,
  MessageBubble,
  PageHeader,
  PubkyChip,
  StatusBanner,
} from '../index';
import { color, radius, measure } from '../../../theme';

jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
  remove: jest.fn(),
} as never);

function hostByTestId(tree: renderer.ReactTestRenderer, testID: string) {
  const matches = tree.root.findAllByProps({ testID });
  const host = matches.find(node => node.props.accessibilityRole);
  if (!host) {
    throw new Error(`No host node for testID=${testID}`);
  }
  return host;
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (typeof style === 'function') {
    return StyleSheet.flatten(style({ pressed: false })) as Record<string, unknown>;
  }
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}

describe('ui primitives', () => {
  it('Button exposes role, label, disabled reason, and 44pt target', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Button
          label="Connect"
          onPress={() => {}}
          disabled
          disabledReason="Waiting for Ring"
          testID="cta"
        />,
      );
    });
    const button = hostByTestId(tree, 'cta');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Connect');
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(button.props.accessibilityHint).toBe('Waiting for Ring');
    expect(flattenStyle(button.props.style).minHeight).toBe(measure.hitTarget);
    expect(tree.root.findByProps({ testID: 'ctaReason' }).props.children).toBe('Waiting for Ring');
  });

  it('Button keeps 44pt minimum at large text', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Button label="Start a chat" onPress={() => {}} testID="cta" />);
    });
    const style = flattenStyle(hostByTestId(tree, 'cta').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('ListRow and PageHeader are labeled interactive targets', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <>
          <PageHeader title="Chats" onBack={() => {}} testID="header" />
          <ListRow
            title="Ada"
            subtitle="pk:abcd"
            meta="2m"
            badge={3}
            onPress={() => {}}
            testID="row"
          />
        </>,
      );
    });
    expect(hostByTestId(tree, 'headerBack').props.accessibilityRole).toBe('button');
    const row = hostByTestId(tree, 'row');
    expect(row.props.accessibilityRole).toBe('button');
    expect(String(row.props.accessibilityLabel)).toContain('Ada');
    expect(tree.root.findAllByProps({ name: 'chevron-forward' }).length).toBeGreaterThan(0);
  });

  it('ListRow keeps unread meta on a body-safe brand text token', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ListRow title="Ada" meta="2m" unread onPress={() => {}} testID="row" />,
      );
    });
    const meta = tree.root.findAllByType(Text).find(node => node.props.children === '2m');
    expect(meta).toBeDefined();
    expect(StyleSheet.flatten(meta?.props.style)).toMatchObject({ color: color.brandText });
  });

  it('EmptyState and StatusBanner keep actions accessible', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <>
          <EmptyState
            title="No chats yet"
            body="Add a contact to start."
            actionLabel="Add a contact"
            onAction={() => {}}
            testID="empty"
          />
          <StatusBanner
            label="You are offline"
            actionLabel="Try again"
            onAction={() => {}}
            testID="banner"
          />
        </>,
      );
    });
    expect(hostByTestId(tree, 'emptyAction').props.accessibilityRole).toBe('button');
    expect(hostByTestId(tree, 'bannerAction').props.accessibilityRole).toBe('button');
  });

  it('Avatar falls back to short pubky initials', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Avatar pubky="pk:abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq" testID="avatar" />,
      );
    });
    const avatar = hostByTestId(tree, 'avatar');
    expect(avatar.props.accessibilityRole).toBe('image');
    expect(String(avatar.props.accessibilityLabel)).toMatch(/abcd/i);
  });

  it('PubkyChip truncates visually while the copy target keeps the full key available', () => {
    const pubky = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<PubkyChip pubky={pubky} onCopy={() => {}} testID="pubkyChip" />);
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('abcdef…wxyz');
    expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('abcdef…wxyz');
    expect(tree.root.findAllByType(Text).some(node => node.props.children === pubky)).toBe(false);
    const chip = hostByTestId(tree, 'pubkyChip');
    expect(chip.props.accessibilityLabel).toBe(pubky);
    expect(chip.props.accessibilityValue).toEqual({ text: pubky });
    expect(hostByTestId(tree, 'pubkyChipCopy').props.accessibilityRole).toBe('button');
  });

  it('DetailRow and MessageBubble expose structured details and accessible status ticks', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <>
          <DetailRow label="Amount" value="0.00010000 BTC" testID="detailRow" />
          <MessageBubble
            mine
            time="10:12 PM"
            status="Sent"
            grouped
            lastInGroup={false}
            testID="bubble"
          >
            <></>
          </MessageBubble>
        </>,
      );
    });
    expect(JSON.stringify(tree.toJSON())).toContain('Amount');
    expect(tree.root.findByProps({ name: 'checkmark-done' }).props.accessibilityLabel).toBe('Sent');
    expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Sent')).toBe(false);
    const bubble = tree.root.findAllByProps({ testID: 'bubble' }).find(node => node.props.style);
    expect(StyleSheet.flatten(bubble?.props.style).borderBottomRightRadius).not.toBe(
      radius.bubbleTail,
    );
  });
});
