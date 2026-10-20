import { createVerzChatApi } from '@whatsapp-platform/api';
import Constants from 'expo-constants';
import { mobileTokenStorage, refreshTokenStorage } from './storage';
import { useAuthStore } from '../store/auth.store';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:3001/api/v1';

export const apiClient = createVerzChatApi({
  baseUrl: API_URL,
  tokenStorage: mobileTokenStorage,
  withCredentials: false,
  getRefreshToken: () => refreshTokenStorage.getSync(),
  onTokenRefreshed: (token) => {
    useAuthStore.getState().setAccessToken(token);
  },
  onRefreshTokenRotated: (token) => {
    void refreshTokenStorage.set(token);
  },
  onSessionExpired: () => {
    void refreshTokenStorage.clear();
    useAuthStore.getState().clearAuth();
  },
});
