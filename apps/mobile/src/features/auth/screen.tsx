/** Phase-1 slice owner: auth. Visual shell only — real OAuth is M1 (gated on
 *  deployment + mobile GitHub OAuth App). Mock "signed-in" toggle. */
import React from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Screen, useThemeColors } from '@/ui';

export function SignInScreen() {
  const router = useRouter();
  const c = useThemeColors();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 8 }}>
        <Text style={{ color: c.text, fontSize: 28, fontWeight: '700', textAlign: 'center' }}>
          Constructor
        </Text>
        <Text style={{ color: c.textSecondary, textAlign: 'center', marginBottom: 24 }}>
          Control your background coding agents
        </Text>
        <Button title="Continue with GitHub" onPress={() => router.replace('/')} />
        <Text style={{ color: c.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 12 }}>
          (mock — real OAuth lands in M1)
        </Text>
      </View>
    </Screen>
  );
}
