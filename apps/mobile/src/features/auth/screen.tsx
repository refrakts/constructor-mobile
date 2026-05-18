/** Real GitHub OAuth sign-in via the gateway (PKCE). Uses expo-web-browser
 *  to open the gateway's /auth/start endpoint, then catches the deep-link
 *  callback `mobile://auth/callback?token=...` via expo-linking. */
import React from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { useAuth } from '@/data/auth';
import { useProfileStore } from '@/features/profiles/profile-store';
import { Button, Screen, useThemeColors } from '@/ui';
import { Fonts, Spacing } from '@/constants/theme';

import { BrandBackdrop } from './brand-backdrop';
import { GitHubMark } from './github-mark';

const ACCENT = '#208AEF';

export function SignInScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const c = useThemeColors();
  const { activeProfile } = useProfileStore();
  const [signingIn, setSigningIn] = React.useState(false);

  // Listen for deep-link callback
  React.useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('mobile://auth/callback')) {
        WebBrowser.dismissBrowser();
        const parsed = new URL(url);
        const token = parsed.searchParams.get('token');
        if (token) {
          signIn(token);
        } else {
          Alert.alert('Sign-in failed', 'Could not complete authentication.');
          setSigningIn(false);
        }
      }
    });
    return () => sub.remove();
  }, [signIn]);

  // Also check for initial URL (cold-start deep link)
  React.useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url && url.startsWith('mobile://auth/callback')) {
        const parsed = new URL(url);
        const token = parsed.searchParams.get('token');
        if (token) signIn(token);
      }
    });
  }, [signIn]);

  const onContinue = React.useCallback(async () => {
    if (!activeProfile) {
      Alert.alert('No connection', 'Add a gateway connection in Settings first.');
      return;
    }
    if (!activeProfile.githubOAuthClientId) {
      Alert.alert('No OAuth config', 'This gateway has not returned a GitHub OAuth client id. Check the connection URL.');
      return;
    }
    setSigningIn(true);
    try {
      const gatewayUrl = activeProfile.gatewayUrl.replace(/\/$/, '');
      const authUrl = `${gatewayUrl}/auth/start?redirect_uri=mobile://auth/callback`;
      await WebBrowser.openBrowserAsync(authUrl);
    } catch {
      setSigningIn(false);
    }
  }, [activeProfile]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <BrandBackdrop />
      <View style={styles.body}>
        <View style={styles.lockup}>
          <View style={[styles.appMark, { borderColor: c.backgroundSelected }]}>
            <Text style={styles.appMarkGlyph}>C</Text>
          </View>
          <Text style={[styles.wordmark, { color: c.text }]}>Constructor</Text>
          <Text style={[styles.tagline, { color: c.textSecondary }]}>
            Control your background coding agents
          </Text>
        </View>

        <View style={styles.flexGap} />

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

          {!activeProfile ? (
            <Text style={[styles.statusCaption, { color: c.textSecondary }]}>
              Add a gateway connection in Settings to sign in.
            </Text>
          ) : !activeProfile.githubOAuthClientId ? (
            <Text style={[styles.statusCaption, { color: c.textSecondary }]}>
              Gateway config not discovered yet. Pull to refresh or re-add the connection.
            </Text>
          ) : (
            <Text style={[styles.statusCaption, { color: c.textSecondary }]}>
              Authenticating via {activeProfile.name}
            </Text>
          )}
        </View>

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
