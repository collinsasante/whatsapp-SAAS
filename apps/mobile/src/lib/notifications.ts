import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { mmkv } from './storage';
import { apiClient } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const PUSH_ENABLED_KEY = 'push_enabled';
const PUSH_TOKEN_KEY = 'push_token';

// Device-local preference (default on) -- distinct from OS permission status.
// Lets a user turn push off inside the app without touching system settings.
export function isPushEnabled(): boolean {
  return mmkv.getString(PUSH_ENABLED_KEY) !== 'false';
}

export function setPushEnabled(enabled: boolean): void {
  mmkv.set(PUSH_ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!isPushEnabled()) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'VerzChat',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#25D366',
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 100, 100, 100],
      lightColor: '#25D366',
    });
  }

  const projectId =
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    'your-eas-project-id';

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    const cached = mmkv.getString(PUSH_TOKEN_KEY);
    if (cached !== token) {
      mmkv.set(PUSH_TOKEN_KEY, token);
      await apiClient.notifications
        .registerPushToken(token, Platform.OS as 'ios' | 'android')
        .catch(() => null);
    }

    return token;
  } catch {
    return null;
  }
}

// Called on logout and when the user turns push off in preferences --
// removes this device's token from the backend so it stops receiving pushes
// for an account it's no longer signed into (or opted out of).
export async function unregisterPushNotifications(): Promise<void> {
  const token = mmkv.getString(PUSH_TOKEN_KEY);
  if (!token) return;
  mmkv.remove(PUSH_TOKEN_KEY);
  await apiClient.notifications.unregisterPushToken(token).catch(() => null);
}
