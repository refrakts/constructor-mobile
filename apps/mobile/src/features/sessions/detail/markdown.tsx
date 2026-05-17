/** Hardened Markdown renderer for streamed assistant text.
 *  `html:false` blocks raw-HTML injection from model output; the MarkdownIt
 *  instance is created once (module scope) so every token re-render reuses it.
 *  Themed via the `style` map so it tracks light/dark from `useThemeColors`. */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';

import { Fonts } from '@/constants/theme';
import { useThemeColors } from '@/ui';

/** Single shared, hardened parser — no per-render allocation, no raw HTML. */
const md = MarkdownIt({ html: false, linkify: true, typographer: false });

export function StreamMarkdown({ content }: { content: string }) {
  const c = useThemeColors();

  // Re-themed only when palette changes (light/dark flip), not per token.
  const styles = useMemo(
    () =>
      ({
        body: { color: c.text, fontSize: 15, fontFamily: Fonts?.sans, lineHeight: 22 },
        paragraph: { marginTop: 0, marginBottom: 8 },
        heading1: { color: c.text, fontSize: 20, fontWeight: '700', marginBottom: 6 },
        heading2: { color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
        heading3: { color: c.text, fontSize: 16, fontWeight: '600', marginBottom: 4 },
        strong: { fontWeight: '700', color: c.text },
        em: { fontStyle: 'italic' },
        link: { color: '#208AEF' },
        bullet_list: { marginBottom: 4 },
        ordered_list: { marginBottom: 4 },
        list_item: { color: c.text },
        blockquote: {
          backgroundColor: c.backgroundElement,
          borderLeftColor: c.backgroundSelected,
          borderLeftWidth: 3,
          paddingHorizontal: 10,
          paddingVertical: 4,
          marginBottom: 8,
        },
        hr: { backgroundColor: c.backgroundSelected, height: StyleSheet.hairlineWidth },
        code_inline: {
          color: c.text,
          backgroundColor: c.backgroundElement,
          borderRadius: 4,
          paddingHorizontal: 4,
          paddingVertical: 1,
          fontFamily: Fonts?.mono,
          fontSize: 13,
        },
        code_block: {
          color: c.text,
          backgroundColor: c.backgroundElement,
          borderRadius: 8,
          padding: 10,
          fontFamily: Fonts?.mono,
          fontSize: 13,
          marginBottom: 8,
        },
        fence: {
          color: c.text,
          backgroundColor: c.backgroundElement,
          borderRadius: 8,
          padding: 10,
          fontFamily: Fonts?.mono,
          fontSize: 13,
          marginBottom: 8,
        },
        table: {
          borderColor: c.backgroundSelected,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 6,
          marginBottom: 8,
        },
        th: { padding: 6, color: c.text },
        td: { padding: 6, color: c.text },
      }) as StyleSheet.NamedStyles<any>,
    [c],
  );

  return (
    <Markdown markdownit={md} style={styles}>
      {content}
    </Markdown>
  );
}
