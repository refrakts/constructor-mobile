/** Phase-1 slice owner: auth. A soft brand wash built without expo-linear-gradient
 *  (not in the manifest, no new deps allowed): absolutely-positioned, heavily
 *  blurred-by-softness circular Views at low alpha. Tuned so the accent stays
 *  visible against both light (#ffffff) and dark (#000000) backgrounds. */
import React from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

// The primary action color from `@/ui` Button (#208AEF) — kept in sync visually.
const ACCENT = '#208AEF';

function withAlpha(hex: string, alpha: number) {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export function BrandBackdrop() {
  const dark = useColorScheme() === 'dark';
  // Dark needs slightly stronger blobs to read against pure black; light stays soft.
  const topAlpha = dark ? 0.22 : 0.14;
  const midAlpha = dark ? 0.16 : 0.1;
  const lowAlpha = dark ? 0.12 : 0.07;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      {/* Large top-right wash */}
      <View
        style={[
          styles.blob,
          {
            width: 460,
            height: 460,
            borderRadius: 230,
            top: -200,
            right: -160,
            backgroundColor: withAlpha(ACCENT, topAlpha),
          },
        ]}
      />
      {/* Mid-left glow */}
      <View
        style={[
          styles.blob,
          {
            width: 360,
            height: 360,
            borderRadius: 180,
            top: 120,
            left: -190,
            backgroundColor: withAlpha(ACCENT, midAlpha),
          },
        ]}
      />
      {/* Soft bottom anchor behind the action */}
      <View
        style={[
          styles.blob,
          {
            width: 520,
            height: 520,
            borderRadius: 260,
            bottom: -320,
            left: -80,
            backgroundColor: withAlpha(ACCENT, lowAlpha),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  blob: { position: 'absolute' },
});
