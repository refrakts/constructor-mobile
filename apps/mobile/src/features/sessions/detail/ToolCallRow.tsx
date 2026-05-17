/** Native collapsible tool-call card. A `tool_call` event is paired (by
 *  `callId`, done in EventRow) with its matching `tool_result`. Collapsed it
 *  shows tool name + a one-line summary + status dot; tapped it expands the
 *  full args and result/output in a monospace block. */
import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';

import type { SandboxEvent } from '@constructor/protocol';
import { Fonts, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/ui';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type ToolCall = Extract<SandboxEvent, { type: 'tool_call' }>;
type ToolResult = Extract<SandboxEvent, { type: 'tool_result' }>;

function pretty(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Compact one-liner from common arg shapes (path/file/command/query…). */
function argSummary(args: Record<string, unknown>): string {
  const keys = ['path', 'file', 'filePath', 'command', 'cmd', 'query', 'pattern', 'url', 'name'];
  for (const k of keys) {
    const v = args?.[k];
    if (typeof v === 'string' && v) return v;
  }
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return '';
  const [k, v] = entries[0];
  return `${k}: ${typeof v === 'string' ? v : pretty(v)}`.slice(0, 80);
}

export function ToolCallRow({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const c = useThemeColors();
  const [open, setOpen] = useState(false);

  const errored = !!result?.error || call.status === 'error' || call.status === 'failed';
  const settled = !!result || call.status === 'success' || call.status === 'completed';
  const dot = errored ? '#E5484D' : settled ? '#30A46C' : '#F5A623';

  const summary = argSummary(call.args);
  const resultText = result ? (result.error ? result.error : result.result) : call.output;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={[s.card, { backgroundColor: c.backgroundElement }]}>
      <Pressable onPress={toggle} style={s.head} android_ripple={{ color: c.backgroundSelected }}>
        <View style={[s.dot, { backgroundColor: dot }]} />
        <View style={s.flex}>
          <Text style={[s.tool, { color: c.text }]} numberOfLines={1}>
            <Text style={s.glyph}>{'⚙ '}</Text>
            {call.tool}
          </Text>
          {summary ? (
            <Text style={[s.sub, { color: c.textSecondary }]} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </View>
        <Text style={[s.chev, { color: c.textSecondary }]}>{open ? '⌄' : '›'}</Text>
      </Pressable>

      {open ? (
        <View style={[s.body, { borderTopColor: c.backgroundSelected }]}>
          <Text style={[s.label, { color: c.textSecondary }]}>ARGS</Text>
          <Text style={[s.mono, { color: c.text }]} selectable>
            {pretty(call.args) || '{}'}
          </Text>
          {resultText ? (
            <>
              <Text style={[s.label, { color: errored ? '#E5484D' : c.textSecondary, marginTop: Spacing.three }]}>
                {errored ? 'ERROR' : 'RESULT'}
              </Text>
              <Text
                style={[s.mono, { color: errored ? '#E5484D' : c.text }]}
                selectable
                numberOfLines={40}
              >
                {resultText}
              </Text>
            </>
          ) : settled ? null : (
            <Text style={[s.sub, { color: c.textSecondary, marginTop: Spacing.two }]}>Running…</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: 12, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tool: { fontSize: 15, fontWeight: '600', fontFamily: Fonts?.sans },
  glyph: { fontSize: 13 },
  sub: { fontSize: 13, marginTop: 2, fontFamily: Fonts?.sans },
  chev: { fontSize: 18, fontWeight: '600', width: 16, textAlign: 'center' },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: Spacing.one },
  mono: { fontSize: 12, fontFamily: Fonts?.mono, lineHeight: 17 },
});
