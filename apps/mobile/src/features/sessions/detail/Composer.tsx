/** Follow-up composer + Stop, shown while the stream is live. Multiline input
 *  with an inline send affordance; Stop sits beside it and calls gateway.stop.
 *  Both actions guard against double-fire with a local pending flag. */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/ui';

export function Composer({
  onSend,
  onStop,
}: {
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);

  const canSend = draft.trim().length > 0 && !sending;

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await onStop();
    } finally {
      setStopping(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View
        style={[
          s.bar,
          {
            backgroundColor: c.background,
            borderTopColor: c.backgroundSelected,
            paddingBottom: Math.max(insets.bottom, Spacing.three),
          },
        ]}
      >
        <Pressable
          onPress={stop}
          disabled={stopping}
          style={[s.stopBtn, { borderColor: '#E5484D', opacity: stopping ? 0.5 : 1 }]}
          hitSlop={8}
        >
          {stopping ? (
            <ActivityIndicator color="#E5484D" size="small" />
          ) : (
            <Text style={s.stopText}>Stop</Text>
          )}
        </Pressable>

        <View style={[s.inputWrap, { backgroundColor: c.backgroundElement }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Send a follow-up…"
            placeholderTextColor={c.textSecondary}
            style={[s.input, { color: c.text }]}
            multiline
            maxLength={4000}
            editable={!sending}
            onSubmitEditing={send}
            blurOnSubmit={false}
            returnKeyType="send"
          />
        </View>

        <Pressable
          onPress={send}
          disabled={!canSend}
          style={[s.sendBtn, { backgroundColor: canSend ? '#208AEF' : c.backgroundSelected }]}
          hitSlop={8}
        >
          {sending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={[s.sendText, { color: canSend ? '#ffffff' : c.textSecondary }]}>↑</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingVertical: Platform.OS === 'ios' ? Spacing.two + 2 : 2,
    minHeight: 40,
    maxHeight: 132,
    justifyContent: 'center',
  },
  input: { fontSize: 15, fontFamily: Fonts?.sans, lineHeight: 20, maxHeight: 120 },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontSize: 20, fontWeight: '700' },
  stopBtn: {
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopText: { color: '#E5484D', fontSize: 14, fontWeight: '700' },
});
