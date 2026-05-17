import { Stack } from 'expo-router';

import { useAuth } from '@/data/auth';
import { AppProviders } from '@/data/provider';
import { useThemeColors } from '@/ui';

/** Fallback route Expo Router resolves to when a guard redirects. */
export const unstable_settings = { anchor: 'index' };

/** Native iOS bottom-sheet presentation (Expo Router v55 / react-native-screens). */
const SHEET = {
  presentation: 'formSheet' as const,
  sheetGrabberVisible: true,
  sheetCornerRadius: 20,
  sheetAllowedDetents: [0.6, 1] as number[],
  sheetInitialDetentIndex: 0,
};

function StackNav() {
  const c = useThemeColors();
  const { signedIn } = useAuth();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Sessions' }} />
        <Stack.Screen name="new" options={{ title: 'New session', ...SHEET }} />
        <Stack.Screen name="s/[id]" options={{ title: 'Session' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen
          name="sign-in"
          options={{ title: 'Sign in', headerShown: false, ...SHEET }}
        />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <StackNav />
    </AppProviders>
  );
}
