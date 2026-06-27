import '../global.css';
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProviders } from '../src/providers';
import { useAuthStore } from '../src/store/auth.store';
import { mobileTokenStorage } from '../src/lib/storage';
import { apiClient } from '../src/lib/api';
import { isTokenExpired } from '@whatsapp-platform/auth';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const setReady = useAuthStore((s) => s.setReady);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const token = mobileTokenStorage.getAccessToken();
        if (token && !isTokenExpired(token)) {
          const res = await apiClient.auth.getMe();
          const { user, tenant } = res.data as { user: AuthUser; tenant: AuthTenant };
          setAuth(user, tenant, token);
        } else if (token) {
          mobileTokenStorage.clearAccessToken();
        }
      } catch {
        mobileTokenStorage.clearAccessToken();
      } finally {
        setReady();
        SplashScreen.hideAsync();
      }
    };

    restoreSession();
  }, [setAuth, setReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProviders>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </AppProviders>
    </GestureHandlerRootView>
  );
}
