import { createVerzChatSocket } from '@whatsapp-platform/socket';
import Constants from 'expo-constants';
import { mobileTokenStorage } from './storage';

const SOCKET_URL =
  (Constants.expoConfig?.extra?.socketUrl as string | undefined) ??
  'http://localhost:3002';

export const socketClient = createVerzChatSocket({
  url: SOCKET_URL,
  getToken: () => mobileTokenStorage.getAccessToken(),
});
