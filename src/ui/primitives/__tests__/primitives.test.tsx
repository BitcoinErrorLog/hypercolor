import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Avatar, Button, EmptyState, ListRow, PageHeader, StatusBanner } from '../index';
import { measure } from '../../../theme';

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
          <ListRow title="Ada" subtitle="pk:abcd" onPress={() => {}} testID="row" />
        </>,
      );
    });
    expect(hostByTestId(tree, 'headerBack').props.accessibilityRole).toBe('button');
    const row = hostByTestId(tree, 'row');
    expect(row.props.accessibilityRole).toBe('button');
    expect(String(row.props.accessibilityLabel)).toContain('Ada');
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
});
