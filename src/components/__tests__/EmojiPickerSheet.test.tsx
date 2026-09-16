import React from 'react';
import { act, create } from 'react-test-renderer';
import { EmojiPickerSheet } from '../EmojiPickerSheet';

jest.mock('react-native', () => {
  const ReactNative = jest.requireActual('react');
  const passthrough = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactNative.createElement('View', props, children);
  return {
    FlatList: ({
      data,
      renderItem,
    }: {
      data: unknown[];
      renderItem: (input: { item: never }) => React.ReactNode;
    }) =>
      ReactNative.createElement(
        'View',
        null,
        data.map((item, index) =>
          ReactNative.createElement(
            ReactNative.Fragment,
            { key: index },
            renderItem({ item: item as never }),
          ),
        ),
      ),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: passthrough,
    TextInput: passthrough,
    TouchableOpacity: passthrough,
    View: passthrough,
  };
});

jest.mock('../../lib/emoji/dataset', () => ({
  BUNDLED_EMOJI: [
    { glyph: '👍', names: ['thumbsup'] },
    { glyph: '👨‍👩‍👧‍👦', names: ['family'] },
    { glyph: '👍👍', names: ['invalid'] },
  ],
}));

jest.mock('../../ui/primitives/SheetChrome', () => ({
  SheetChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('EmojiPickerSheet', () => {
  it('only offers glyphs accepted by chat tag validation', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<EmojiPickerSheet visible onClose={jest.fn()} onPick={jest.fn()} />);
    });

    expect(tree.root.findAllByProps({ testID: 'emojiCell-thumbsup' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'emojiCell-family' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'emojiCell-invalid' })).toHaveLength(0);
  });
});
