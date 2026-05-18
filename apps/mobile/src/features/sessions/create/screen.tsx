import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  getDefaultReasoningEffort,
  getReasoningConfig,
  supportsReasoning,
  type ReasoningEffort,
  type ValidModel,
} from '@constructor/protocol';
import { useCreateSession, useGateway } from '@/data/queries';
import { GatewayError } from '@/data/errors';
import { Fonts, Spacing } from '@/constants/theme';
import { AppBar, Button, Screen, TextField, useThemeColors } from '@/ui';

const ACCENT = '#208AEF';

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
};

function effortLabel(effort: ReasoningEffort | undefined): string {
  return effort ? EFFORT_LABEL[effort] : 'Auto';
}

function modelName(id: ValidModel): string {
  for (const group of MODEL_OPTIONS) {
    const found = group.models.find((m) => m.id === id);
    if (found) return found.name;
  }
  return id;
}

function titleFromPrompt(prompt: string): string | undefined {
  const firstLine = prompt.trim().split('\n').find(Boolean)?.trim();
  if (!firstLine) return undefined;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

export function CreateSessionScreen() {
  const router = useRouter();
  const create = useCreateSession();
  const gateway = useGateway();
  const c = useThemeColors();

  const [repo, setRepo] = useState('refrakts/constructor-mobile');
  const [branch, setBranch] = useState('main');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<ValidModel>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<ReasoningEffort | undefined>(
    getDefaultReasoningEffort(DEFAULT_MODEL),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedRepo = useMemo(() => {
    const [owner = '', name = ''] = repo.trim().split('/');
    return { owner: owner.trim(), name: name.trim() };
  }, [repo]);

  const reasoningConfig = getReasoningConfig(model);
  const canSubmit =
    parsedRepo.owner.length > 0 &&
    parsedRepo.name.length > 0 &&
    prompt.trim().length > 0 &&
    !submitting;

  const onModelChange = (next: ValidModel) => {
    setModel(next);
    setEffort(getDefaultReasoningEffort(next));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    let sessionId = createdSessionId;
    try {
      if (!sessionId) {
        const res = await create.mutateAsync({
          repoOwner: parsedRepo.owner,
          repoName: parsedRepo.name,
          title: titleFromPrompt(prompt),
          branch: branch.trim() || undefined,
          model,
          reasoningEffort: effort || undefined,
        });
        sessionId = res.sessionId;
        setCreatedSessionId(sessionId);
      }
      await gateway.sendFollowUp(sessionId, prompt.trim());
      router.replace({ pathname: '/s/[id]', params: { id: sessionId } });
    } catch (e) {
      const friendly =
        e instanceof GatewayError
          ? e.userMessage() + (e.requestId ? ` (request ${e.requestId})` : '')
          : e instanceof Error
            ? e.message
            : 'Network request failed.';
      setError(
        sessionId
          ? `Session was created, but the prompt was not sent. Retry will send it to the existing session. ${friendly}`
          : friendly,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openCreatedSession = () => {
    if (!createdSessionId) return;
    router.replace({ pathname: '/s/[id]', params: { id: createdSessionId } });
  };

  return (
    <Screen>
      <AppBar title="New session" />
      <KeyboardAvoidingView
        style={st.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={st.flex}
          contentContainerStyle={st.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={st.hero}>
            <Text style={[st.kicker, { color: c.textSecondary }]}>START WITH THE TASK</Text>
            <Text style={[st.title, { color: c.text }]}>What should the agent do?</Text>
          </View>

          <View style={[st.composer, { backgroundColor: c.backgroundElement }]}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Describe the change, bug, or investigation..."
              placeholderTextColor={c.textSecondary}
              editable={!submitting}
              multiline
              textAlignVertical="top"
              style={[st.prompt, { color: c.text }]}
            />
            <View style={st.composerFooter}>
              <Text style={[st.contextText, { color: c.textSecondary }]} numberOfLines={1}>
                {parsedRepo.owner || 'owner'}/{parsedRepo.name || 'repo'} · {branch.trim() || 'default branch'}
              </Text>
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                style={[st.send, { opacity: canSubmit ? 1 : 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel="Start session"
              >
                <Text style={st.sendText}>{submitting ? '...' : 'Go'}</Text>
              </Pressable>
            </View>
          </View>

          <View style={[st.card, { backgroundColor: c.backgroundElement }]}>
            <TextField
              label="Repository"
              value={repo}
              onChangeText={setRepo}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="owner/repo"
              editable={!submitting}
            />
            <TextField
              label="Base branch"
              value={branch}
              onChangeText={setBranch}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="main"
              editable={!submitting}
            />
          </View>

          <Pressable
            onPress={() => setShowAdvanced((v) => !v)}
            style={[st.advancedHeader, { borderColor: c.backgroundSelected }]}
          >
            <View style={st.flex}>
              <Text style={[st.advancedTitle, { color: c.text }]}>Model</Text>
              <Text style={[st.advancedSub, { color: c.textSecondary }]} numberOfLines={1}>
                {modelName(model)}{supportsReasoning(model) ? ` · ${effortLabel(effort)}` : ''}
              </Text>
            </View>
            <Text style={[st.disclosure, { color: c.textSecondary }]}>
              {showAdvanced ? 'Hide' : 'Change'}
            </Text>
          </Pressable>

          {showAdvanced ? (
            <View style={st.advancedBody}>
              {MODEL_OPTIONS.map((group) => (
                <View key={group.category} style={st.optionGroup}>
                  <Text style={[st.groupTitle, { color: c.textSecondary }]}>{group.category.toUpperCase()}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={st.pillRow}>
                      {group.models.map((m) => {
                        const selected = m.id === model;
                        return (
                          <Pressable
                            key={m.id}
                            onPress={() => onModelChange(m.id)}
                            style={[
                              st.pill,
                              {
                                borderColor: selected ? ACCENT : c.backgroundSelected,
                                backgroundColor: selected ? `${ACCENT}22` : c.backgroundElement,
                              },
                            ]}
                          >
                            <Text style={[st.pillText, { color: selected ? ACCENT : c.text }]}>
                              {m.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              ))}

              {reasoningConfig ? (
                <View style={st.optionGroup}>
                  <Text style={[st.groupTitle, { color: c.textSecondary }]}>REASONING</Text>
                  <View style={st.pillRowWrap}>
                    {reasoningConfig.default === undefined ? (
                      <ReasoningPill label="Auto" selected={effort === undefined} onPress={() => setEffort(undefined)} />
                    ) : null}
                    {reasoningConfig.efforts.map((next) => (
                      <ReasoningPill
                        key={next}
                        label={effortLabel(next)}
                        selected={effort === next}
                        onPress={() => setEffort(next)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {error ? (
            <View style={st.errorBox}>
              <Text style={st.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            title={submitting ? 'Starting session...' : createdSessionId ? 'Retry sending prompt' : 'Start session'}
            onPress={submit}
            disabled={!canSubmit}
          />
          {createdSessionId ? (
            <Button
              title="Open created session"
              variant="ghost"
              onPress={openCreatedSession}
              disabled={submitting}
            />
          ) : null}
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => router.back()}
            disabled={submitting}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ReasoningPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        st.pill,
        {
          borderColor: selected ? ACCENT : c.backgroundSelected,
          backgroundColor: selected ? `${ACCENT}22` : c.backgroundElement,
        },
      ]}
    >
      <Text style={[st.pillText, { color: selected ? ACCENT : c.text }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: Spacing.six },
  hero: { paddingHorizontal: Spacing.three, paddingTop: Spacing.four },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, fontFamily: Fonts.sans },
  title: { fontSize: 30, fontWeight: '800', marginTop: Spacing.two, fontFamily: Fonts.sans },
  composer: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.four,
    borderRadius: 24,
    padding: Spacing.three,
    minHeight: 220,
  },
  prompt: { flex: 1, minHeight: 150, fontSize: 18, lineHeight: 25, fontFamily: Fonts.sans },
  composerFooter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  contextText: { flex: 1, fontSize: 13, fontFamily: Fonts.sans },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 24, fontWeight: '800', lineHeight: 26 },
  card: { marginHorizontal: Spacing.three, marginTop: Spacing.three, borderRadius: 18, paddingBottom: Spacing.three },
  advancedHeader: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  advancedTitle: { fontSize: 16, fontWeight: '700', fontFamily: Fonts.sans },
  advancedSub: { fontSize: 13, marginTop: 2, fontFamily: Fonts.sans },
  disclosure: { fontSize: 14, fontWeight: '700', fontFamily: Fonts.sans },
  advancedBody: { paddingTop: Spacing.three },
  optionGroup: { marginBottom: Spacing.three },
  groupTitle: { fontSize: 12, fontWeight: '700', marginLeft: Spacing.four, marginBottom: Spacing.two, fontFamily: Fonts.sans },
  pillRow: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three },
  pillRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.three },
  pill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  pillText: { fontSize: 14, fontWeight: '700', fontFamily: Fonts.sans },
  errorBox: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5484D',
    backgroundColor: '#E5484D22',
  },
  errorText: { color: '#E5484D', fontSize: 14, fontWeight: '600', fontFamily: Fonts.sans },
});
