/** Phase-1 slice owner: sessions/detail. Functional placeholder: real stream
 *  via useSessionStream + ported transforms. Enrich with FlashList +
 *  maintainVisibleContentPosition + tool-call rows per spec §6. */
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useLocalSearchParams } from 'expo-router';

import { useGateway, useSessionStream } from '@/data/queries';
import { AppBar, Badge, Button, Loading, Screen, TextField, useThemeColors } from '@/ui';

export function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useThemeColors();
  const gw = useGateway();
  const { status, state, events, cost } = useSessionStream(id);
  const [draft, setDraft] = useState('');

  if (status === 'connecting' && events.length === 0) {
    return <Screen><Loading label="Connecting…" /></Screen>;
  }

  return (
    <Screen>
      <AppBar
        title={state?.title ?? 'Session'}
        right={<Badge text={status} tone={status === 'live' ? 'good' : 'neutral'} />}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {events.map((e, i) => {
          if (e.type === 'token') {
            return (
              <View key={i} style={{ backgroundColor: c.backgroundElement, borderRadius: 12, padding: 12 }}>
                <Markdown style={{ body: { color: c.text } }}>{e.content}</Markdown>
              </View>
            );
          }
          if (e.type === 'tool_call') {
            return (
              <Text key={i} style={{ color: c.textSecondary, fontFamily: 'ui-monospace' }}>
                ⚙ {e.tool}({JSON.stringify(e.args)})
              </Text>
            );
          }
          if (e.type === 'error') {
            return <Text key={i} style={{ color: '#E5484D' }}>✗ {e.error}</Text>;
          }
          if (e.type === 'execution_complete') {
            return (
              <Text key={i} style={{ color: e.success ? '#30A46C' : '#E5484D' }}>
                {e.success ? '✓ done' : '✗ failed'} · ${cost.toFixed(4)}
              </Text>
            );
          }
          if (e.type === 'user_message') {
            return <Text key={i} style={{ color: c.text, fontWeight: '600' }}>{e.content}</Text>;
          }
          return null;
        })}
      </ScrollView>
      <View style={{ padding: 8, gap: 8 }}>
        <TextField placeholder="Send a follow-up…" value={draft} onChangeText={setDraft} />
        <Button
          title="Send"
          onPress={async () => {
            await gw.sendFollowUp(id, draft);
            setDraft('');
          }}
          disabled={!draft.trim()}
        />
      </View>
    </Screen>
  );
}
