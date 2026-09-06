import React from 'react';
import { Alert, Linking, StyleSheet, Text, type TextStyle } from 'react-native';
import { parseInlineMarkdown } from '../../lib/markdown/parseInlineMarkdown';
import { color, typeRole } from '../../theme';
import { COPY } from '../../copy/uxCopy';

export type MarkdownTextProps = {
  source: string;
  color: string;
  testID?: string;
};

function confirmOpen(url: string): void {
  Alert.alert(COPY.openExternalLinkTitle, url, [
    { text: COPY.cancel, style: 'cancel' },
    {
      text: COPY.open,
      onPress: () => {
        void Linking.openURL(url);
      },
    },
  ]);
}

export function MarkdownText({ source, color: textColor, testID }: MarkdownTextProps) {
  const nodes = parseInlineMarkdown(source);
  return (
    <Text {...(testID ? { testID } : {})} style={[styles.base, { color: textColor }]}>
      {nodes.map((node, index) => {
        if (node.type === 'text') {
          return <Text key={index}>{node.value}</Text>;
        }
        if (node.type === 'bold') {
          return (
            <Text key={index} style={styles.bold}>
              {node.value}
            </Text>
          );
        }
        if (node.type === 'italic') {
          return (
            <Text key={index} style={styles.italic}>
              {node.value}
            </Text>
          );
        }
        if (node.type === 'code') {
          return (
            <Text key={index} style={styles.code}>
              {node.value}
            </Text>
          );
        }
        return (
          <Text
            key={index}
            style={styles.link}
            accessibilityRole="link"
            accessibilityLabel={node.value}
            onPress={() => confirmOpen(node.href)}
          >
            {node.value}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: typeRole.callout.fontSize,
    lineHeight: 20,
  },
  bold: { fontWeight: '700' } satisfies TextStyle,
  italic: { fontStyle: 'italic' } satisfies TextStyle,
  code: {
    fontFamily: 'Menlo',
    backgroundColor: color.overlaySoft,
  },
  link: {
    textDecorationLine: 'underline',
    color: color.brandMuted,
  },
});
