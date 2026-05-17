/** Phase-1 slice owner: sessions/list. Placeholder is functional (real mock
 *  data via useSessions) — enrich styling/empty/error per spec §6. */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { useSessions } from '@/data/queries';
import { AppBar, Badge, EmptyState, Loading, Screen, Section, ListItem } from '@/ui';

const tone = (s: string) =>
  s === 'active' ? 'good' : s === 'failed' ? 'bad' : s === 'completed' ? 'neutral' : 'warn';

export function SessionListScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSessions();

  return (
    <Screen scroll>
      <AppBar
        title="Sessions"
        right={
          <Pressable onPress={() => router.push('/new')} hitSlop={12}>
            <Text style={{ color: '#208AEF', fontSize: 28, fontWeight: '300' }}>＋</Text>
          </Pressable>
        }
      />
      {isLoading ? (
        <Loading label="Loading sessions…" />
      ) : isError ? (
        <EmptyState title="Couldn’t load sessions" hint="Pull to retry" />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No sessions yet" hint="Tap ＋ to start one" />
      ) : (
        <Section>
          {data.map((sess, i) => (
            <ListItem
              key={sess.id}
              title={sess.title ?? `${sess.repoOwner}/${sess.repoName}`}
              subtitle={`${sess.repoOwner}/${sess.repoName} · ${sess.baseBranch}`}
              trailing={<Badge text={sess.status} tone={tone(sess.status)} />}
              onPress={() => router.push({ pathname: '/s/[id]', params: { id: sess.id } })}
              last={i === data.length - 1}
            />
          ))}
        </Section>
      )}
      <Pressable onPress={() => router.push('/settings')} style={{ padding: 24, alignItems: 'center' }}>
        <Text style={{ color: '#208AEF' }}>Settings & connections</Text>
      </Pressable>
      {!isLoading && (
        <Pressable onPress={() => refetch()} style={{ alignItems: 'center', paddingBottom: 24 }}>
          <Text style={{ color: '#8E8E93' }}>Refresh</Text>
        </Pressable>
      )}
    </Screen>
  );
}
