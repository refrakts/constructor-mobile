/**
 * Reusable connection-profile form (add + edit).
 *
 * Collects ONLY `name` + `gatewayUrl` (PLAN-02: `wsUrl` is discovered from the
 * gateway, never typed). Inline, on-submit validation with native-iOS-styled
 * error rows. Uses only `@/ui` primitives + core RN.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { Button, Section, useThemeColors } from '@/ui';

import {
  type DraftErrors,
  type ProfileDraft,
  hasErrors,
  validateDraft,
} from './profile-store';
import { ValidatedField } from './ValidatedField';

export function ProfileForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit';
  initial?: ProfileDraft;
  submitLabel: string;
  onSubmit: (draft: ProfileDraft) => void;
  onCancel?: () => void;
}) {
  const c = useThemeColors();
  const [name, setName] = useState(initial?.name ?? '');
  const [gatewayUrl, setGatewayUrl] = useState(initial?.gatewayUrl ?? '');
  const [touched, setTouched] = useState(false);

  const draft: ProfileDraft = { name, gatewayUrl };
  const errors: DraftErrors = useMemo(() => validateDraft(draft), [name, gatewayUrl]);
  const showErrors = touched;

  const handleSubmit = () => {
    setTouched(true);
    if (hasErrors(errors)) return;
    onSubmit({ name: name.trim(), gatewayUrl: gatewayUrl.trim() });
  };

  return (
    <View>
      <Section title={mode === 'add' ? 'Add connection' : 'Edit connection'}>
        <ValidatedField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="My deployment"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          error={showErrors ? errors.name : undefined}
        />
        <ValidatedField
          label="Gateway URL"
          value={gatewayUrl}
          onChangeText={setGatewayUrl}
          placeholder="https://gateway.example.workers.dev"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          error={showErrors ? errors.gatewayUrl : undefined}
          last
        />
      </Section>

      <Text style={[styles.helpText, { color: c.textSecondary }]}>
        The websocket URL is discovered automatically from the gateway after you
        connect — you don&apos;t need to enter it.
      </Text>

      <Button title={submitLabel} onPress={handleSubmit} />
      {onCancel ? (
        <Button title="Cancel" variant="ghost" onPress={onCancel} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  helpText: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
});
