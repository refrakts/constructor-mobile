/**
 * `@/ui` `TextField` + an inline validation message and a focus/error accent.
 * The shared `TextField` primitive (frozen `src/ui`) has no error slot, so the
 * slice adds one here without touching the wrapper.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View, type TextInputProps } from 'react-native';

import { Spacing } from '@/constants/theme';
import { TextField, useThemeColors } from '@/ui';

const ACCENT = '#208AEF';
const DANGER = '#E5484D';

export function ValidatedField({
  label,
  error,
  last,
  onFocus,
  onBlur,
  style,
  ...rest
}: TextInputProps & { label: string; error?: string; last?: boolean }) {
  const c = useThemeColors();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? DANGER : focused ? ACCENT : 'transparent';

  return (
    <View style={[styles.wrap, !last && styles.divided, { borderBottomColor: c.backgroundSelected }]}>
      <TextField
        label={label}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { borderColor }, style]}
        {...rest}
      />
      {error ? (
        <Text style={[styles.error, { color: DANGER }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: Spacing.three },
  divided: { borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1 },
  error: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: Spacing.two,
    marginLeft: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
});
