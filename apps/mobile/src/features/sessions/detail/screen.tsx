/** Phase-1 slice owner: sessions/detail — the live session event stream.
 *
 *  Append-only FlashList (v2, new arch) over the folded `SandboxEvent[]` from
 *  `useSessionStream`. `maintainVisibleContentPosition` (on by default in v2)
 *  keeps it pinned to the newest event while the user is at the bottom; a
 *  floating "Jump to latest" appears once they scroll up. Header carries the
 *  title, a live/closed status badge and the running cost. While live, a
 *  follow-up composer + Stop are shown. Connecting / empty / closed states are
 *  all handled. Data flows ONLY through `@/data/queries`.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';

import type { SandboxEvent } from '@constructor/protocol';
import { useGateway, useSessionStream } from '@/data/queries';
import { Fonts, Spacing } from '@/constants/theme';
import { AppBar, Badge, EmptyState, Loading, Screen, useThemeColors } from '@/ui';

import { Composer } from './Composer';
import { EventRow } from './EventRow';

type ToolResult = Extract<SandboxEvent, { type: 'tool_result' }>;

/** Stable per-event key (events are append-only; folding only mutates the
 *  trailing token in place, so type+timestamp+index is collision-free here). */
function eventKey(e: SandboxEvent, i: number): string {
  const id =
    'callId' in e && e.callId
      ? e.callId
      : 'messageId' in e && e.messageId
        ? e.messageId
        : '';
  return `${i}:${e.type}:${id}:${e.timestamp}`;
}

export function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useThemeColors();
  const gw = useGateway();
  const { status, state, events, cost } = useSessionStream(id);

  const listRef = useRef<FlashListRef<SandboxEvent>>(null);
  const [atBottom, setAtBottom] = useState(true);

  const title = state?.title ?? 'Session';
  const live = status === 'live';

  // Pair tool_result→tool_call by callId so each call shows its outcome inline,
  // and so a paired result isn't also rendered as its own row.
  const { resultsByCallId, pairedCallIds } = useMemo(() => {
    const byId = new Map<string, ToolResult>();
    const calls = new Set<string>();
    for (const e of events) {
      if (e.type === 'tool_result') byId.set(e.callId, e);
      else if (e.type === 'tool_call') calls.add(e.callId);
    }
    const paired = new Set<string>();
    for (const cid of calls) if (byId.has(cid)) paired.add(cid);
    return { resultsByCallId: byId, pairedCallIds: paired };
  }, [events]);

  const renderItem = useCallback(
    ({ item }: { item: SandboxEvent }) => (
      <EventRow
        event={item}
        resultsByCallId={resultsByCallId}
        pairedCallIds={pairedCallIds}
        cost={cost}
      />
    ),
    [resultsByCallId, pairedCallIds, cost],
  );

  const getItemType = useCallback((item: SandboxEvent) => item.type, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setAtBottom(distanceFromBottom < 80);
  }, []);

  const jumpToLatest = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setAtBottom(true);
  }, []);

  const sendFollowUp = useCallback(
    async (text: string) => {
      await gw.sendFollowUp(id, text);
    },
    [gw, id],
  );

  const stop = useCallback(async () => {
    await gw.stop(id);
  }, [gw, id]);

  // Connecting: snapshot not yet delivered and nothing to show.
  if (status === 'connecting' && events.length === 0) {
    return (
      <Screen>
        <AppBar title={title} right={<Badge text="connecting" tone="warn" />} />
        <Loading label="Connecting to session…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar
        title={title}
        right={
          <View style={s.headerRight}>
            {cost > 0 ? (
              <Text style={[s.cost, { color: c.textSecondary }]}>${cost.toFixed(4)}</Text>
            ) : null}
            <Badge
              text={live ? 'live' : status === 'closed' ? 'closed' : status}
              tone={live ? 'good' : 'neutral'}
            />
          </View>
        }
      />

      <View style={s.flex}>
        {events.length === 0 ? (
          <EmptyState
            title="No activity yet"
            hint={live ? 'Waiting for the agent…' : 'This session has no events.'}
          />
        ) : (
          <FlashList
            ref={listRef}
            data={events}
            renderItem={renderItem}
            keyExtractor={eventKey}
            getItemType={getItemType}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={s.listContent}
            ItemSeparatorComponent={Gap}
            showsVerticalScrollIndicator
            maintainVisibleContentPosition={{
              // v2: on by default. Stick to bottom while the user is near it;
              // anchor the first paint at the latest event (chat-style).
              autoscrollToBottomThreshold: 0.2,
              startRenderingFromBottom: true,
              animateAutoScrollToBottom: true,
            }}
          />
        )}

        {!atBottom && events.length > 0 ? (
          <Pressable
            onPress={jumpToLatest}
            style={[
              s.jump,
              { backgroundColor: '#208AEF', bottom: live ? Spacing.three : Spacing.four },
            ]}
            hitSlop={8}
          >
            <Text style={s.jumpText}>↓ Jump to latest</Text>
          </Pressable>
        ) : null}
      </View>

      {live ? (
        <Composer onSend={sendFollowUp} onStop={stop} />
      ) : (
        <View style={[s.closedBar, { borderTopColor: c.backgroundSelected }]}>
          <Text style={[s.closedText, { color: c.textSecondary }]}>
            {status === 'closed' ? 'Session ended' : 'Not connected'}
          </Text>
        </View>
      )}
    </Screen>
  );
}

function Gap() {
  return <View style={s.gap} />;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cost: { fontSize: 13, fontFamily: Fonts?.mono },
  listContent: { padding: Spacing.three },
  gap: { height: Spacing.three },
  jump: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  jumpText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  closedBar: {
    paddingVertical: Spacing.three,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  closedText: { fontSize: 13, fontWeight: '500' },
});
