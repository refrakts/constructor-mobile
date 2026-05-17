/** Phase-1 slice owner: auth. Visual shell only — real OAuth is M1 (gated on
 *  deployment + a mobile GitHub OAuth App). The primary action is a MOCK that
 *  routes to '/'; no expo-auth-session, no real GitHub flow here. The in-progress
 *  state below is cosmetic so the screen feels production-real on Expo Go.
 *
 *  Visual richness is built from `@/ui` primitives + RN core only: no
 *  expo-linear-gradient / react-native-svg (not in the manifest, no new deps). */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Button, Screen, useThemeColors } from '@/ui';
import { Fonts, Spacing } from '@/constants/theme';

import { BrandBackdrop } from './brand-backdrop';
import { GitHubMark } from './github-mark';

const ACCENT = '#208AEF';

export function SignInScreen() {
  const router = useRouter();
  const c = useThemeColors();
  const [signingIn, setSigningIn] = React.useState(false);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Mock-only: brief cosmetic "connecting" beat, then route home. The real
  // GitHub OAuth handshake replaces this body wholesale in M1.
  const onContinue = React.useCallback(() => {
    if (signingIn) return;
    setSigningIn(true);
    timer.current = setTimeout(() => router.replace('/'), 550);
  }, [router, signingIn]);

  return (
    <Screen>
      {/* Per-screen override only — does not touch the frozen src/app layout;
          keeps the modal presentation, drops the stock "Sign in" header so the
          brand lockup reads as the hero. */}
      <Stack.Screen options={{ headerShown: false }} />
      <BrandBackdrop />
      <View style={styles.body}>
        {/* --- Brand lockup -------------------------------------------------- */}
        <View style={styles.lockup}>
          <View style={[styles.appMark, { borderColor: c.backgroundSelected }]}>
            <Text style={styles.appMarkGlyph}>C</Text>
          </View>
          <Text style={[styles.wordmark, { color: c.text }]}>Constructor</Text>
          <Text style={[styles.tagline, { color: c.textSecondary }]}>
            Control your background coding agents
          </Text>
        </View>

        {/* --- Spacer ------------------------------------------------------- */}
        <View style={styles.flexGap} />

        {/* --- Auth affordance ---------------------------------------------- */}
        <View style={styles.authBlock}>
          <View
            style={[
              styles.providerRow,
              { backgroundColor: c.backgroundElement, borderColor: c.backgroundSelected },
            ]}
          >
            <View style={styles.providerMark}>
              <GitHubMark size={26} color={c.text} />
            </View>
            <View style={styles.providerCopy}>
              <Text style={[styles.providerTitle, { color: c.text }]}>GitHub</Text>
              <Text style={[styles.providerSub, { color: c.textSecondary }]} numberOfLines={1}>
                Sign in to manage your agent sessions
              </Text>
            </View>
            {signingIn ? <ActivityIndicator color={ACCENT} /> : null}
          </View>

          <Button
            title={signingIn ? 'Connecting…' : 'Continue with GitHub'}
            onPress={onContinue}
            disabled={signingIn}
          />

          <Text style={[styles.statusCaption, { color: c.textSecondary }]}>
            Mock sign-in · real GitHub OAuth lands in M1
          </Text>
        </View>

        {/* --- Legal footnote ----------------------------------------------- */}
        <Text style={[styles.legal, { color: c.textSecondary }]}>
          By continuing you agree to the Terms of Service and acknowledge the Privacy Policy.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.six,
    paddingBottom: Spacing.four,
  },
  // Brand lockup
  lockup: { alignItems: 'center', gap: Spacing.three },
  appMark: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: ACCENT,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  appMarkGlyph: {
    color: '#ffffff',
    fontSize: 40,
    fontWeight: '800',
    fontFamily: Fonts.rounded,
    marginTop: -2,
  },
  wordmark: {
    fontSize: 34,
    fontWeight: '800',
    fontFamily: Fonts.rounded,
    letterSpacing: 0.2,
    marginTop: Spacing.one,
  },
  tagline: {
    fontSize: 16,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  flexGap: { flex: 1, minHeight: Spacing.five },
  // Auth block — the @/ui Button supplies its own marginTop (Spacing.four),
  // so no extra gap here keeps the provider row → button rhythm tight.
  authBlock: {},
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.three,
  },
  providerMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerCopy: { flex: 1 },
  providerTitle: { fontSize: 16, fontWeight: '600', fontFamily: Fonts.sans },
  providerSub: { fontSize: 13, marginTop: 2, fontFamily: Fonts.sans },
  statusCaption: {
    fontSize: 12,
    textAlign: 'center',
    fontFamily: Fonts.sans,
    marginTop: Spacing.two,
  },
  // Legal
  legal: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    fontFamily: Fonts.sans,
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.four,
    opacity: 0.85,
  },
});
