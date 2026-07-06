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

export async function registerForPushNotifications(): Promise<string | null> {
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

    const cached = mmkv.getString('push_token');
    if (cached !== token) {
      mmkv.set('push_token', token);
      // Attempt registration with backend — endpoint may not exist yet
      apiClient.http
        .post('/notifications/push-token', { token, platform: Platform.OS })
        .catch(() => null);
    }

    return token;
  } catch {
    return null;
  }
}
