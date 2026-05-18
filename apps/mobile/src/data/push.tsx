import React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { useAuth } from './auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function PushRegistration({ gatewayUrl }: { gatewayUrl?: string }) {
  const { signedIn, token } = useAuth();

  React.useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      const sessionId = response.notification.request.content.data?.sessionId;
      if (typeof url === 'string') router.push(url);
      else if (typeof sessionId === 'string') router.push(`/s/${sessionId}`);
    });
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    if (!signedIn || !token || !gatewayUrl || gatewayUrl.startsWith('mock://')) return;
    let cancelled = false;
    registerForPushNotificationsAsync()
      .then(async (expoToken) => {
        if (!expoToken || cancelled) return;
        await fetch(`${gatewayUrl.replace(/\/$/, '')}/push/register`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ expoToken }),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, signedIn, token]);

  return null;
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('session-updates', {
      name: 'Session updates',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}
