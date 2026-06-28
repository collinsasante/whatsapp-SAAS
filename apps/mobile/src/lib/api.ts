import { createVerzChatApi } from '@whatsapp-platform/api';
import Constants from 'expo-constants';
import { mobileTokenStorage } from './storage';
import { useAuthStore } from '../store/auth.store';

const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:3001/api/v1';

export const apiClient = createVerzChatApi({
  baseUrl: API_URL,
  tokenStorage: mobileTokenStorage,
  withCredentials: false,
  onTokenRefreshed: (token) => {
    useAuthStore.getState().setAccessToken(token);
  },
  onSessionExpired: () => {
    useAuthStore.getState().clearAuth();
  },
});
