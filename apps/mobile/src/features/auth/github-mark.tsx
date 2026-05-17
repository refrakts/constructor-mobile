/** Phase-1 slice owner: auth. GitHub glyph composed from pure RN Views — no SVG,
 *  no new deps (react-native-svg / expo-linear-gradient are not in the manifest).
 *  A stylized octocat silhouette: rounded head, two ear notches, a body, and a
 *  short tentacle. Reads as an intentional minimal mark, not a broken icon. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

export function GitHubMark({ size = 30, color = '#ffffff' }: { size?: number; color?: string }) {
  // All sub-shapes are expressed as fractions of `size` so the mark scales cleanly.
  const u = (n: number) => Math.round(size * n);
  const tint = { backgroundColor: color };

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-start' }}>
      {/* Ears */}
      <View
        style={[
          styles.shape,
          tint,
          {
            width: u(0.26),
            height: u(0.26),
            borderRadius: u(0.13),
            left: u(0.16),
            top: u(0.02),
            transform: [{ rotate: '-22deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.shape,
          tint,
          {
            width: u(0.26),
            height: u(0.26),
            borderRadius: u(0.13),
            right: u(0.16),
            top: u(0.02),
            transform: [{ rotate: '22deg' }],
          },
        ]}
      />
      {/* Head */}
      <View
        style={[
          styles.shape,
          tint,
          {
            width: u(0.78),
            height: u(0.72),
            borderRadius: u(0.39),
            left: u(0.11),
            top: u(0.1),
          },
        ]}
      />
      {/* Body / chin merges into the head, squared at the bottom for the silhouette */}
      <View
        style={[
          styles.shape,
          tint,
          {
            width: u(0.5),
            height: u(0.34),
            borderBottomLeftRadius: u(0.16),
            borderBottomRightRadius: u(0.16),
            left: u(0.25),
            top: u(0.58),
          },
        ]}
      />
      {/* Tentacle */}
      <View
        style={[
          styles.shape,
          tint,
          {
            width: u(0.12),
            height: u(0.26),
            borderBottomLeftRadius: u(0.06),
            borderBottomRightRadius: u(0.06),
            left: u(0.62),
            top: u(0.78),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shape: { position: 'absolute' },
});
