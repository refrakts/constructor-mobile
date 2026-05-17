/** Phase-1 slice owner: profiles/settings. Functional placeholder — connection
 *  profiles per PLAN-02 (user enters only gatewayUrl; wsUrl via GET /config).
 *  Persistence behind a store seam lands with the slice build. */
import React, { useState } from 'react';
import { useRouter } from 'expo-router';

import { Button, ListItem, Screen, Section, TextField } from '@/ui';

export function SettingsScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  return (
    <Screen scroll>
      <Section title="Connections">
        <ListItem title="Local mock" subtitle="active · no backend (UI preview)" last />
      </Section>
      <Section title="Add connection">
        <TextField label="Name" value={name} onChangeText={setName} placeholder="My deployment" />
        <TextField
          label="Gateway URL"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://gateway.example.workers.dev"
        />
      </Section>
      <Button title="Save connection" onPress={() => setUrl('')} disabled={!name || !url} />
      <Button title="Sign in" variant="ghost" onPress={() => router.push('/sign-in')} />
    </Screen>
  );
}
