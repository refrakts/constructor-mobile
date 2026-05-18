import React from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { useAuth } from '@/data/auth';
import { Screen, useThemeColors } from '@/ui';
import { Fonts, Spacing } from '@/constants/theme';

import { PENDING_STATE_KEY } from './constants';

export function AuthCallbackScreen() {
  const { token, state } = useLocalSearchParams<{ token?: string; state?: string }>();
  const { signIn } = useAuth();
  const router = useRouter();
  const c = useThemeColors();

  React.useEffect(() => {
    let mounted = true;
    WebBrowser.dismissBrowser();
    SecureStore.getItemAsync(PENDING_STATE_KEY)
      .then(async (pendingState) => {
        if (!mounted) return;
        if (!token || !state || !pendingState || state !== pendingState) {
          Alert.alert('Sign-in failed', 'Could not complete authentication.');
          router.replace('/sign-in');
          return;
        }
        await SecureStore.deleteItemAsync(PENDING_STATE_KEY).catch(() => undefined);
        signIn(token);
        router.replace('/');
      })
      .catch(() => {
        if (!mounted) return;
        Alert.alert('Sign-in failed', 'Could not complete authentication.');
        router.replace('/sign-in');
      });
    return () => {
      mounted = false;
    };
  }, [router, signIn, state, token]);

  return (
    <Screen>
      <View style={styles.body}>
        <ActivityIndicator color={c.tint} />
        <Text style={[styles.text, { color: c.textSecondary }]}>Completing sign-in...</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  text: {
    fontFamily: Fonts.body,
    fontSize: 15,
  },
});
