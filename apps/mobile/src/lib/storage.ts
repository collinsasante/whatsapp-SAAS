import { createMMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@whatsapp-platform/api';

export const mmkv = createMMKV({ id: 'verzchat-store' });

// Synchronous token storage using MMKV (for API client interceptors)
export const mobileTokenStorage: TokenStorage = {
  getAccessToken: () => mmkv.getString('access_token') ?? null,
  setAccessToken: (token: string) => mmkv.set('access_token', token),
  clearAccessToken: () => mmkv.remove('access_token'),
};

// Refresh token lives in SecureStore (encrypted, async)
export const refreshTokenStorage = {
  get: (): Promise<string | null> => SecureStore.getItemAsync('refresh_token'),
  set: (token: string): Promise<void> => SecureStore.setItemAsync('refresh_token', token),
  clear: (): Promise<void> => SecureStore.deleteItemAsync('refresh_token'),
};

export const secureStorage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  clear: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};
