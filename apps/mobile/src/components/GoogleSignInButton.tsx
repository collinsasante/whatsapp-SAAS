import React, { useEffect } from 'react';
import { TouchableOpacity, Text, View, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { router } from 'expo-router';
import { apiClient } from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';

WebBrowser.maybeCompleteAuthSession();

// Firebase Web API key — public value, same as web app
const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyAIsxrezFn4O-XoSv4f9X-rQ_AMBG36cP8';
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

interface Props {
  onError?: (msg: string) => void;
}

export function GoogleSignInButton({ onError }: Props) {
  const setAuth = useAuthStore((s) => s.setAuth);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'verzchat', path: 'auth' });

  // PKCE authorization code flow — Google requires this for public clients (no client secret)
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID ?? '',
      redirectUri,
      scopes: ['openid', 'email', 'profile'],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery,
  );

  useEffect(() => {
    if (response?.type !== 'success') return;
    const { code } = response.params;
    if (!code || !request?.codeVerifier) {
      onError?.('Google sign-in did not return an authorization code.');
      return;
    }
    void exchangeCode(code, request.codeVerifier);
  }, [response]);

  const exchangeCode = async (code: string, codeVerifier: string) => {
    try {
      // Exchange code for tokens — PKCE means no client secret is needed
      const tokenResult = await AuthSession.exchangeCodeAsync(
        {
          code,
          clientId: GOOGLE_CLIENT_ID ?? '',
          redirectUri,
          extraParams: { code_verifier: codeVerifier },
        },
        { tokenEndpoint: 'https://oauth2.googleapis.com/token' },
      );

      const googleAccessToken = tokenResult.accessToken;
      if (!googleAccessToken) throw new Error('No access token');

      // Exchange Google access token for Firebase ID token
      const firebaseRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postBody: `access_token=${googleAccessToken}&providerId=google.com`,
            requestUri: 'http://localhost',
            returnIdpCredential: true,
            returnSecureToken: true,
          }),
        },
      );
      if (!firebaseRes.ok) throw new Error('Firebase sign-in failed');
      const firebaseData = (await firebaseRes.json()) as { idToken?: string };
      if (!firebaseData.idToken) throw new Error('No Firebase ID token');

      // Send Firebase ID token to our backend — same endpoint as the web app
      const res = await apiClient.auth.firebaseLogin(firebaseData.idToken);
      const { user, tenant, accessToken } = res.data as {
        user: AuthUser;
        tenant: AuthTenant;
        accessToken: string;
      };
      setAuth(user, tenant, accessToken);
      router.replace('/(app)');
    } catch {
      onError?.('Google sign-in failed. Please try again.');
    }
  };

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <TouchableOpacity
      className="border border-white/15 rounded-xl py-3.5 items-center flex-row justify-center gap-3"
      onPress={() => void promptAsync()}
      disabled={!request}
      activeOpacity={0.8}
    >
      {!request ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <>
          <GoogleLogo />
          <Text className="text-white font-semibold text-base">Continue with Google</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function GoogleLogo() {
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#4285F4', lineHeight: 20 }}>G</Text>
    </View>
  );
}
