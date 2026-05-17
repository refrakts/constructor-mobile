import { Stack } from 'expo-router';

import { AppProviders } from '@/data/provider';
import { useThemeColors } from '@/ui';

function StackNav() {
  const c = useThemeColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Sessions' }} />
      <Stack.Screen name="new" options={{ title: 'New session', presentation: 'modal' }} />
      <Stack.Screen name="s/[id]" options={{ title: 'Session' }} />
      <Stack.Screen name="sign-in" options={{ title: 'Sign in', presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
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
