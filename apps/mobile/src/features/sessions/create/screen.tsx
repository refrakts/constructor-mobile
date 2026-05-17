/** Phase-1 slice owner: sessions/create. Functional placeholder. */
import React, { useState } from 'react';
import { useRouter } from 'expo-router';

import { useCreateSession } from '@/data/queries';
import { Button, Loading, Screen, Section, TextField } from '@/ui';

export function CreateSessionScreen() {
  const router = useRouter();
  const create = useCreateSession();
  const [repoOwner, setRepoOwner] = useState('refrakts');
  const [repoName, setRepoName] = useState('constructor-mobile');
  const [title, setTitle] = useState('');
  const [branch, setBranch] = useState('main');

  if (create.isPending) return <Screen><Loading label="Creating session…" /></Screen>;

  const submit = async () => {
    const res = await create.mutateAsync({ repoOwner, repoName, title: title || undefined, branch });
    router.replace({ pathname: '/s/[id]', params: { id: res.sessionId } });
  };

  return (
    <Screen scroll>
      <Section title="Repository">
        <TextField label="Owner" value={repoOwner} onChangeText={setRepoOwner} autoCapitalize="none" />
        <TextField label="Repo" value={repoName} onChangeText={setRepoName} autoCapitalize="none" />
        <TextField label="Base branch" value={branch} onChangeText={setBranch} autoCapitalize="none" />
      </Section>
      <Section title="Task">
        <TextField label="Title (optional)" value={title} onChangeText={setTitle} placeholder="e.g. Add dark mode" />
      </Section>
      <Button title="Start session" onPress={submit} disabled={!repoOwner || !repoName} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
