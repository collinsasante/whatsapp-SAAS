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
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';
import { GoogleSignInButton } from '../../src/components/GoogleSignInButton';
import { useAppTheme } from '../../src/theme/useAppTheme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const { colors, isDark } = useAppTheme();

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
      const res = await apiClient.auth.loginMobile(cleanEmail, cleanPassword);
      const result = res.data as {
        requiresWorkspaceSelection?: boolean;
        requiresPin?: boolean;
        requiresPinSetup?: boolean;
        tempToken?: string;
        workspaces?: Array<{ id: string; name: string; role: string }>;
        user?: AuthUser;
        tenant?: AuthTenant;
        accessToken?: string;
        refreshToken?: string;
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
        setAuth(result.user, result.tenant, result.accessToken, result.refreshToken);
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
      className="flex-1 bg-light-background dark:bg-surface"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: '30%' }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10">
          <Image
            source={isDark ? require('../../assets/images/verz-wordmark-white.png') : require('../../assets/images/verz-wordmark-dark.png')}
            style={{ width: 150, height: 34, marginBottom: 20 }}
            contentFit="contain"
          />
          <Text className="text-light-text-secondary dark:text-white/60 text-base">Sign in to your workspace</Text>
        </View>

        <View className="gap-4">
          {/* Email */}
          <View>
            <Text className="text-light-text-secondary dark:text-white/70 text-sm font-medium mb-2">Email</Text>
            <TextInput
              className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3.5 text-light-text-primary dark:text-white text-base"
              placeholder="you@company.com"
              placeholderTextColor={colors.textDisabled}
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
            <Text className="text-light-text-secondary dark:text-white/70 text-sm font-medium mb-2">Password</Text>
            <View className="flex-row items-center bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl">
              <TextInput
                ref={passwordRef}
                className="flex-1 px-4 py-3.5 text-light-text-primary dark:text-white text-base"
                placeholder="••••••••"
                placeholderTextColor={colors.textDisabled}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={Platform.OS === 'android' ? 'off' : 'current-password'}
                textContentType="password"
                returnKeyType="done"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={handleLogin}
                editable={!isLoading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                className="px-4 py-3.5"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>
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
            <Text className="text-light-text-muted dark:text-white/50 text-sm">Forgot password?</Text>
          </TouchableOpacity>

          <View className="flex-row items-center gap-3 mt-4">
            <View className="flex-1 h-px bg-light-border dark:bg-white/10" />
            <Text className="text-light-text-disabled dark:text-white/30 text-xs">or</Text>
            <View className="flex-1 h-px bg-light-border dark:bg-white/10" />
          </View>

          <GoogleSignInButton
            onError={(msg) => Alert.alert('Google Sign-In', msg)}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
