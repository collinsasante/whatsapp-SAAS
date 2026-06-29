import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';
import { GoogleSignInButton } from '../../src/components/GoogleSignInButton';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isReady = useAuthStore((s) => s.isReady);
  const setAuth = useAuthStore((s) => s.setAuth);

  if (isReady && isAuthenticated) {
    return <Redirect href="/(app)" />;
  }

  const handleLogin = async () => {
    const cleanEmail = email.toLowerCase().trim();
    const cleanPassword = password.trim();

    if (!cleanEmail) { Alert.alert('Login Failed', 'Please enter your email.'); return; }
    if (!cleanPassword) { Alert.alert('Login Failed', 'Please enter your password.'); return; }
    if (!/\S+@\S+\.\S+/.test(cleanEmail)) { Alert.alert('Login Failed', 'Please enter a valid email address.'); return; }

    setIsLoading(true);
    try {
      const res = await apiClient.auth.login(cleanEmail, cleanPassword);
      const result = res.data as {
        requiresWorkspaceSelection?: boolean;
        requiresPin?: boolean;
        requiresPinSetup?: boolean;
        tempToken?: string;
        workspaces?: Array<{ id: string; name: string; role: string }>;
        user?: AuthUser;
        tenant?: AuthTenant;
        accessToken?: string;
      };

      if (result.requiresWorkspaceSelection && result.tempToken && result.workspaces) {
        router.push({
          pathname: '/(auth)/workspace-select',
          params: {
            tempToken: result.tempToken,
            workspaces: JSON.stringify(result.workspaces),
          },
        });
        return;
      }

      if ((result.requiresPin || result.requiresPinSetup) && result.tempToken) {
        router.push({
          pathname: '/(auth)/verify-pin',
          params: {
            tempToken: result.tempToken,
            mode: result.requiresPinSetup ? 'setup' : 'verify',
          },
        });
        return;
      }

      if (result.user && result.tenant && result.accessToken) {
        setAuth(result.user, result.tenant, result.accessToken);
        router.replace('/(app)');
      }
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
      const raw = errData?.message;
      const msg = Array.isArray(raw)
        ? raw[0] ?? 'Invalid credentials'
        : raw ?? 'Invalid email or password. Please try again.';
      if (msg === 'Please sign in with Google') {
        Alert.alert('Use Google Sign-In', 'This account was created with Google. Please use "Continue with Google" below.');
      } else {
        Alert.alert('Login Failed', msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-surface"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10">
          <Text className="text-white text-4xl font-extrabold mb-2">VerzChat</Text>
          <Text className="text-white/60 text-base">Sign in to your workspace</Text>
        </View>

        <View className="gap-4">
          {/* Email */}
          <View>
            <Text className="text-white/70 text-sm font-medium mb-2">Email</Text>
            <TextInput
              className="bg-surface-card border border-white/10 rounded-xl px-4 py-3.5 text-white text-base"
              placeholder="you@company.com"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!isLoading}
            />
          </View>

          {/* Password */}
          <View>
            <Text className="text-white/70 text-sm font-medium mb-2">Password</Text>
            <TextInput
              ref={passwordRef}
              className="bg-surface-card border border-white/10 rounded-xl px-4 py-3.5 text-white text-base"
              placeholder="••••••••"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="done"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
              editable={!isLoading}
            />
          </View>

          <TouchableOpacity
            className="bg-green rounded-xl py-4 items-center mt-2"
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-bold text-base">Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="items-center mt-2"
            onPress={() => router.push('/(auth)/forgot-password')}
          >
            <Text className="text-white/50 text-sm">Forgot password?</Text>
          </TouchableOpacity>

          <View className="flex-row items-center gap-3 mt-4">
            <View className="flex-1 h-px bg-white/10" />
            <Text className="text-white/30 text-xs">or</Text>
            <View className="flex-1 h-px bg-white/10" />
          </View>

          <GoogleSignInButton
            onError={(msg) => Alert.alert('Google Sign-In', msg)}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
