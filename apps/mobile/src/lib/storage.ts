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

// Refresh token lives in SecureStore (encrypted, async) but the shared API
// client's silentRefresh needs it synchronously -- an in-memory cache backs
// reads, hydrated once at startup (see refreshTokenStorage.hydrate) and kept
// in sync on every write.
let refreshTokenCache: string | null = null;

export const refreshTokenStorage = {
  hydrate: async (): Promise<void> => {
    refreshTokenCache = await SecureStore.getItemAsync('refresh_token');
  },
  getSync: (): string | null => refreshTokenCache,
  get: (): Promise<string | null> => SecureStore.getItemAsync('refresh_token'),
  set: (token: string): Promise<void> => {
    refreshTokenCache = token;
    return SecureStore.setItemAsync('refresh_token', token);
  },
  clear: (): Promise<void> => {
    refreshTokenCache = null;
    return SecureStore.deleteItemAsync('refresh_token');
  },
};

export const secureStorage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  clear: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};
