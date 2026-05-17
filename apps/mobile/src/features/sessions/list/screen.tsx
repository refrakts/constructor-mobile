/**
 * Phase-1 slice owner: sessions/list (spec §6).
 *
 * Native-iOS session list: status-grouped sections rendered with the `@/ui`
 * `Section` card + `ListItem` chrome, a status Badge, relative "updated"
 * timestamps, a prominent ＋ → /new, a Settings gear → /settings, and
 * pull-to-refresh wired to `refetch`. Loading / empty / error all live inside
 * the same pullable surface so the RefreshControl (and its retry affordance)
 * applies uniformly.
 *
 * Why a local scroll surface: `@/ui` `Screen` only renders a *non*-refreshable
 * ScrollView under `scroll`. The slice spec explicitly requires a
 * `RefreshControl`, so this slice owns its scroll surface — a core RN
 * `ScrollView` + `RefreshControl` (both core RN; `RefreshControl` is named by
 * the slice spec). Every piece of visible chrome still uses `@/ui` primitives.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import type { Session, SessionStatus } from '@constructor/protocol';
import { useSessions } from '@/data/queries';
import {
  AppBar,
  Badge,
  Button,
  EmptyState,
  ListItem,
  Loading,
  Screen,
  Section,
  useThemeColors,
} from '@/ui';
import { Spacing } from '@/constants/theme';

import { describeUpdated, formatRelative } from './relative-time';

const ACCENT = '#208AEF';

/** Spec §6 verbatim: active→good, completed→neutral, failed→bad, else→warn. */
type Tone = 'neutral' | 'good' | 'warn' | 'bad';
function statusTone(status: SessionStatus | string): Tone {
  if (status === 'active') return 'good';
  if (status === 'failed') return 'bad';
  if (status === 'completed') return 'neutral';
  return 'warn'; // created · archived · cancelled · unknown
}

const STATUS_LABEL: Record<string, string> = {
  created: 'Queued',
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
  archived: 'Archived',
  cancelled: 'Cancelled',
};
const statusLabel = (status: SessionStatus | string) =>
  STATUS_LABEL[status] ?? String(status);

type SessionGroup = { key: string; title: string; items: Session[] };

const byUpdatedDesc = (a: Session, b: Session) => b.updatedAt - a.updatedAt;

/** iOS-Settings-style grouping. Only non-empty groups are emitted so the
 *  screen never shows a dangling header at small data sizes. */
function groupSessions(sessions: Session[]): SessionGroup[] {
  const active: Session[] = [];
  const recent: Session[] = [];
  for (const sess of sessions) {
    (sess.status === 'active' ? active : recent).push(sess);
  }
  const groups: SessionGroup[] = [];
  if (active.length) {
    groups.push({ key: 'active', title: 'Active', items: active.sort(byUpdatedDesc) });
  }
  if (recent.length) {
    groups.push({ key: 'recent', title: 'Recent', items: recent.sort(byUpdatedDesc) });
  }
  return groups;
}

function HeaderActions({
  onSettings,
  onNew,
}: {
  onSettings: () => void;
  onNew: () => void;
}) {
  const c = useThemeColors();
  return (
    <View style={s.actions}>
      <Pressable
        onPress={onSettings}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Settings and connections"
      >
        <Text style={[s.gear, { color: c.textSecondary }]}>{'⚙︎'}</Text>
      </Pressable>
      <Pressable
        onPress={onNew}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Start a new session"
      >
        <Text style={[s.plus, { color: ACCENT }]}>＋</Text>
      </Pressable>
    </View>
  );
}

function SessionTrailing({ session }: { session: Session }) {
  const c = useThemeColors();
  return (
    <View
      style={s.trailing}
      accessible
      accessibilityLabel={`${statusLabel(session.status)}. ${describeUpdated(
        session.updatedAt,
      )}`}
    >
      <Text
        style={[s.time, { color: c.textSecondary }]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {formatRelative(session.updatedAt)}
      </Text>
      <Badge text={statusLabel(session.status)} tone={statusTone(session.status)} />
    </View>
  );
}

/** A status group rendered as a `@/ui` Section card with `count` in the header. */
function SessionGroupCard({
  group,
  onOpen,
}: {
  group: SessionGroup;
  onOpen: (id: string) => void;
}) {
  const heading = `${group.title}  ·  ${group.items.length}`;
  return (
    <Section title={heading}>
      {group.items.map((session, i) => (
        <ListItem
          key={session.id}
          title={session.title ?? `${session.repoOwner}/${session.repoName}`}
          subtitle={`${session.repoOwner}/${session.repoName} · ${session.baseBranch}`}
          trailing={<SessionTrailing session={session} />}
          onPress={() => onOpen(session.id)}
          last={i === group.items.length - 1}
        />
      ))}
    </Section>
  );
}

export function SessionListScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSessions();
  const [refreshing, setRefreshing] = useState(false);

  const groups = useMemo(() => groupSessions(data ?? []), [data]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const openSession = useCallback(
    (id: string) => router.push({ pathname: '/s/[id]', params: { id } }),
    [router],
  );

  // Only the very first load (nothing cached) gets the centered spinner.
  const showInitialLoading = isLoading && !data;
  const isEmpty = !isError && !showInitialLoading && groups.length === 0;
  const fillCenter = isError || isEmpty;

  return (
    <Screen>
      <AppBar
        title="Sessions"
        right={
          <HeaderActions
            onSettings={() => router.push('/settings')}
            onNew={() => router.push('/new')}
          />
        }
      />

      {showInitialLoading ? (
        <Loading label="Loading sessions…" />
      ) : (
        <ScrollView
            style={s.flex}
            contentContainerStyle={[s.content, fillCenter && s.contentFill]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={ACCENT}
                colors={[ACCENT]}
              />
            }
          >
            {isError ? (
              <View style={s.stateBlock}>
                <EmptyState
                  title="Couldn’t load sessions"
                  hint="Pull down to refresh, or tap Try again."
                />
                <View style={s.stateAction}>
                  <Button title="Try again" variant="ghost" onPress={onRefresh} />
                </View>
              </View>
            ) : isEmpty ? (
              <View style={s.stateBlock}>
                <EmptyState
                  title="No sessions yet"
                  hint="Kick off an agent on your repo to get started."
                />
                <View style={s.stateAction}>
                  <Button title="New session" onPress={() => router.push('/new')} />
                </View>
              </View>
            ) : (
              groups.map((group) => (
                <SessionGroupCard key={group.key} group={group} onOpen={openSession} />
              ))
            )}
          </ScrollView>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  gear: { fontSize: 22, fontWeight: '400' },
  plus: { fontSize: 30, fontWeight: '300', lineHeight: 32 },

  content: { paddingBottom: Spacing.six },
  contentFill: { flexGrow: 1, justifyContent: 'center' },

  trailing: { alignItems: 'flex-end', gap: Spacing.one, maxWidth: 132 },
  time: { fontSize: 12, fontWeight: '500' },

  stateBlock: { alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three },
  stateAction: { alignSelf: 'stretch' },
});
