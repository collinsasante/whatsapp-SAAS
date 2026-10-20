import '../global.css';
import React, { useCallback, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProviders } from '../src/providers';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { SplashAnimation } from '../src/components/SplashAnimation';
import { useAuthStore } from '../src/store/auth.store';
import { mobileTokenStorage, refreshTokenStorage } from '../src/lib/storage';
import { apiClient } from '../src/lib/api';
import { isTokenExpired } from '@whatsapp-platform/auth';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';
import { initTheme } from '../src/theme/themeStorage';
import { useAppTheme } from '../src/theme/useAppTheme';

SplashScreen.preventAutoHideAsync();
initTheme();

function RootLayoutInner() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const setReady = useAuthStore((s) => s.setReady);
  const isReady = useAuthStore((s) => s.isReady);
  const [splashDone, setSplashDone] = useState(false);
  const { isDark } = useAppTheme();

  useEffect(() => {
    const restoreSession = async () => {
      try {
        // Hydrate the in-memory refresh-token cache from SecureStore before
        // any request runs -- the API client's 401 retry reads it synchronously.
        await refreshTokenStorage.hydrate();

        const token = mobileTokenStorage.getAccessToken();
        const hasRefreshToken = !!refreshTokenStorage.getSync();
        if (token && (!isTokenExpired(token) || hasRefreshToken)) {
          // getMe() with an expired access token 401s once, which the API
          // client's interceptor silently recovers from via the stored
          // refresh token before retrying -- no manual refresh call needed here.
          const res = await apiClient.auth.getMe();
          const { user, tenant } = res.data as { user: AuthUser; tenant: AuthTenant };
          setAuth(user, tenant, mobileTokenStorage.getAccessToken() ?? token);
        } else if (token) {
          mobileTokenStorage.clearAccessToken();
        }
      } catch {
        mobileTokenStorage.clearAccessToken();
        await refreshTokenStorage.clear();
      } finally {
        setReady();
        // Hide the native splash immediately, our JS splash takes over
        SplashScreen.hideAsync();
      }
    };

    restoreSession();
  }, [setAuth, setReady]);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }} />
      {!splashDone && (
        <SplashAnimation visible={!isReady} onComplete={handleSplashComplete} />
      )}
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AppProviders>
          <RootLayoutInner />
        </AppProviders>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
