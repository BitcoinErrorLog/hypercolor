import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { DaySeparator } from '../DaySeparator';
import { MarkdownText } from '../MarkdownText';
import { measure } from '../../../theme';

describe('DaySeparator', () => {
  it('exposes a header role and label', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<DaySeparator label="Sep 6, 2026" testID="day" />);
    });
    const matches = tree.root.findAllByProps({ testID: 'day' });
    const host = matches.find(node => node.props.accessibilityRole === 'header' || node.props.role);
    if (!host) throw new Error('DaySeparator host missing');
    expect(host.props.accessibilityLabel).toBe('Sep 6, 2026');
    expect(host.props.accessible).toBe(true);
    expect(host.props.accessibilityRole === 'header' || host.props.role === 'heading').toBe(true);
  });
});

describe('MarkdownText', () => {
  it('renders sanitized markdown nodes', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MarkdownText source="**hi** [x](javascript:alert(1))" color="#fff" testID="md" />,
      );
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('hi');
    expect(json).toContain('[x](javascript:alert(1))');
  });
});

describe('hit target contract', () => {
  it('keeps the 44pt token', () => {
    expect(measure.hitTarget).toBe(44);
  });
});
