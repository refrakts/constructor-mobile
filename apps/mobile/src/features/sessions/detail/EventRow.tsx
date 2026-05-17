/** Maps one folded `SandboxEvent` to its native presentation.
 *
 *  - user_message      → right-aligned sent bubble
 *  - token             → assistant markdown card (cumulative text, folded upstream)
 *  - tool_call         → collapsible ToolCallRow (paired with its tool_result)
 *  - tool_result       → rendered ONLY if orphaned (no matching tool_call rendered)
 *  - step_start/finish  → subtle separator line (+ cost/tokens on finish)
 *  - error             → prominent red callout
 *  - execution_complete → terminal success/cost row
 *  - heartbeat / others → null (ignored)
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SandboxEvent } from '@constructor/protocol';
import { Fonts, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/ui';

import { StreamMarkdown } from './markdown';
import { ToolCallRow } from './ToolCallRow';

type ToolResult = Extract<SandboxEvent, { type: 'tool_result' }>;

export function EventRow({
  event,
  resultsByCallId,
  pairedCallIds,
  cost,
}: {
  event: SandboxEvent;
  /** callId → its tool_result, so a tool_call can show its outcome inline. */
  resultsByCallId: Map<string, ToolResult>;
  /** callIds whose result is already shown inside a ToolCallRow. */
  pairedCallIds: Set<string>;
  /** Running accumulated cost (rendered on the terminal row). */
  cost: number;
}) {
  const c = useThemeColors();

  switch (event.type) {
    case 'user_message':
      return (
        <View style={s.userWrap}>
          <View style={[s.userBubble, { backgroundColor: '#208AEF' }]}>
            <Text style={s.userText}>{event.content}</Text>
          </View>
        </View>
      );

    case 'token':
      return (
        <View style={[s.assistant, { backgroundColor: c.backgroundElement }]}>
          <StreamMarkdown content={event.content} />
        </View>
      );

    case 'tool_call':
      return <ToolCallRow call={event} result={resultsByCallId.get(event.callId)} />;

    case 'tool_result':
      // Shown inside its ToolCallRow when paired; render standalone only if orphaned.
      if (pairedCallIds.has(event.callId)) return null;
      return (
        <View style={[s.assistant, { backgroundColor: c.backgroundElement }]}>
          <Text style={[s.metaLabel, { color: event.error ? '#E5484D' : c.textSecondary }]}>
            {event.error ? 'TOOL ERROR' : 'TOOL RESULT'}
          </Text>
          <Text
            style={[s.mono, { color: event.error ? '#E5484D' : c.text }]}
            selectable
            numberOfLines={40}
          >
            {event.error || event.result}
          </Text>
        </View>
      );

    case 'step_start':
      return (
        <View style={s.stepRow}>
          <View style={[s.hair, { backgroundColor: c.backgroundSelected }]} />
          <Text style={[s.stepText, { color: c.textSecondary }]}>
            {event.isSubtask ? 'subtask' : 'thinking'}
          </Text>
          <View style={[s.hair, { backgroundColor: c.backgroundSelected }]} />
        </View>
      );

    case 'step_finish': {
      const bits: string[] = [];
      if (typeof event.cost === 'number' && event.cost > 0) bits.push(`$${event.cost.toFixed(4)}`);
      if (typeof event.tokens === 'number' && event.tokens > 0)
        bits.push(`${event.tokens.toLocaleString()} tok`);
      return (
        <View style={s.stepRow}>
          <View style={[s.hair, { backgroundColor: c.backgroundSelected }]} />
          <Text style={[s.stepText, { color: c.textSecondary }]}>
            {bits.length ? `step · ${bits.join(' · ')}` : 'step complete'}
          </Text>
          <View style={[s.hair, { backgroundColor: c.backgroundSelected }]} />
        </View>
      );
    }

    case 'error':
      return (
        <View style={[s.errorCard, { borderColor: '#E5484D' }]}>
          <Text style={s.errorTitle}>Error</Text>
          <Text style={[s.mono, { color: '#E5484D' }]} selectable>
            {event.error}
          </Text>
        </View>
      );

    case 'execution_complete':
      return (
        <View
          style={[
            s.terminal,
            {
              backgroundColor: c.backgroundElement,
              borderColor: event.success ? '#30A46C' : '#E5484D',
            },
          ]}
        >
          <Text style={[s.terminalText, { color: event.success ? '#30A46C' : '#E5484D' }]}>
            {event.success ? '✓ Completed' : '✗ Failed'}
          </Text>
          <Text style={[s.terminalCost, { color: c.textSecondary }]}>
            {event.error ? event.error : `$${cost.toFixed(4)}`}
          </Text>
        </View>
      );

    // git_sync, artifact, push_complete, push_error, heartbeat → not in this view
    default:
      return null;
  }
}

const s = StyleSheet.create({
  userWrap: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '85%',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  userText: { color: '#ffffff', fontSize: 15, fontFamily: Fonts?.sans, lineHeight: 21 },
  assistant: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
  },
  metaLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: Spacing.one },
  mono: { fontSize: 12, fontFamily: Fonts?.mono, lineHeight: 17 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 2 },
  hair: { flex: 1, height: StyleSheet.hairlineWidth },
  stepText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  errorCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#E5484D14',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
  },
  errorTitle: { color: '#E5484D', fontSize: 14, fontWeight: '700', marginBottom: Spacing.one },
  terminal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  terminalText: { fontSize: 15, fontWeight: '700', fontFamily: Fonts?.sans },
  terminalCost: { fontSize: 13, fontFamily: Fonts?.mono },
});
