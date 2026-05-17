/** Phase-1 slice owner: sessions/create. Native-iOS create-session form. */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  DEFAULT_MODEL,
  getDefaultReasoningEffort,
  supportsReasoning,
  type ReasoningEffort,
  type ValidModel,
} from '@constructor/protocol';
import { useCreateSession } from '@/data/queries';
import { Spacing } from '@/constants/theme';
import {
  AppBar,
  Button,
  Screen,
  Section,
  TextField,
  useThemeColors,
} from '@/ui';

import { ModelSelector } from './model-selector';
import { ReasoningSelector, effortLabel } from './reasoning-selector';

export function CreateSessionScreen() {
  const router = useRouter();
  const create = useCreateSession();
  const c = useThemeColors();

  const [repoOwner, setRepoOwner] = useState('refrakts');
  const [repoName, setRepoName] = useState('constructor-mobile');
  const [title, setTitle] = useState('');
  const [branch, setBranch] = useState('main');
  const [model, setModel] = useState<ValidModel>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<ReasoningEffort | undefined>(
    getDefaultReasoningEffort(DEFAULT_MODEL),
  );
  const [error, setError] = useState<string | null>(null);

  // Effort validity is per-model; re-seed it from the new model's default
  // whenever the model changes so we never submit an invalid combination.
  const onModelChange = (next: ValidModel) => {
    setModel(next);
    setEffort(getDefaultReasoningEffort(next));
  };

  const canSubmit =
    repoOwner.trim().length > 0 &&
    repoName.trim().length > 0 &&
    !create.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    const branchTrimmed = branch.trim();
    const titleTrimmed = title.trim();
    try {
      const res = await create.mutateAsync({
        repoOwner: repoOwner.trim(),
        repoName: repoName.trim(),
        title: titleTrimmed || undefined,
        branch: branchTrimmed || undefined,
        model,
        reasoningEffort: effort || undefined,
      });
      router.replace({ pathname: '/s/[id]', params: { id: res.sessionId } });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not create the session. Try again.',
      );
    }
  };

  const reasoning = supportsReasoning(model);

  return (
    <Screen scroll>
      <AppBar title="New Session" />

      <Section title="Repository">
        <TextField
          label="Owner"
          value={repoOwner}
          onChangeText={setRepoOwner}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. refrakts"
          editable={!create.isPending}
        />
        <TextField
          label="Repo"
          value={repoName}
          onChangeText={setRepoName}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. constructor-mobile"
          editable={!create.isPending}
        />
        <TextField
          label="Base branch (optional)"
          value={branch}
          onChangeText={setBranch}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="main"
          editable={!create.isPending}
        />
      </Section>

      <Section title="Task">
        <TextField
          label="Title (optional)"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Add dark mode"
          editable={!create.isPending}
        />
      </Section>

      <Section title="Model">
        <ModelSelector value={model} onChange={onModelChange} />
      </Section>

      {reasoning ? (
        <Section title={`Reasoning Effort · ${effortLabel(effort)}`}>
          <ReasoningSelector model={model} value={effort} onChange={setEffort} />
        </Section>
      ) : null}

      {error ? (
        <View style={st.errorBox}>
          <Text style={[st.errorText, { color: '#E5484D' }]}>{error}</Text>
        </View>
      ) : null}

      <Button
        title={create.isPending ? 'Starting…' : 'Start session'}
        onPress={submit}
        disabled={!canSubmit}
      />
      <Button
        title="Cancel"
        variant="ghost"
        onPress={() => router.back()}
        disabled={create.isPending}
      />

      <View style={[st.footnote]}>
        <Text style={[st.footnoteText, { color: c.textSecondary }]}>
          A new agent session will start on{' '}
          {repoOwner.trim() || '…'}/{repoName.trim() || '…'}.
        </Text>
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  errorBox: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5484D',
    backgroundColor: '#E5484D22',
  },
  errorText: { fontSize: 14, fontWeight: '500' },
  footnote: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    alignItems: 'center',
  },
  footnoteText: { fontSize: 13, textAlign: 'center' },
});
