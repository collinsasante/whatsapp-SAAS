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
import { mobileTokenStorage } from '../src/lib/storage';
import { apiClient } from '../src/lib/api';
import { isTokenExpired } from '@whatsapp-platform/auth';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';

SplashScreen.preventAutoHideAsync();

function RootLayoutInner() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const setReady = useAuthStore((s) => s.setReady);
  const isReady = useAuthStore((s) => s.isReady);
  const [splashDone, setSplashDone] = useState(false);

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
      <StatusBar style="light" />
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
