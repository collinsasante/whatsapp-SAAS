import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@whatsapp-platform/validation';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';
import { GoogleSignInButton } from '../../src/components/GoogleSignInButton';

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isReady = useAuthStore((s) => s.isReady);
  const setAuth = useAuthStore((s) => s.setAuth);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  if (isReady && isAuthenticated) {
    return <Redirect href="/(app)" />;
  }

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    try {
      const res = await apiClient.auth.login(data.email.toLowerCase().trim(), data.password.trim());
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
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed. Please check your credentials.';
      if (msg === 'Please sign in with Google') {
        Alert.alert(
          'Use Google Sign-In',
          'This account was created with Google. Please use the "Continue with Google" button below.',
        );
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
      <View className="flex-1 justify-center px-6">
        <View className="mb-10">
          <Text className="text-white text-4xl font-extrabold mb-2">VerzChat</Text>
          <Text className="text-white/60 text-base">Sign in to your workspace</Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="text-white/70 text-sm font-medium mb-2">Email</Text>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3.5 text-white text-base"
                  placeholder="you@company.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
              )}
            />
            {errors.email && (
              <Text className="text-red-400 text-xs mt-1">{errors.email.message}</Text>
            )}
          </View>

          <View>
            <Text className="text-white/70 text-sm font-medium mb-2">Password</Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3.5 text-white text-base"
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  importantForAutofill="noExcludeDescendants"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
              )}
            />
            {errors.password && (
              <Text className="text-red-400 text-xs mt-1">{errors.password.message}</Text>
            )}
          </View>

          <TouchableOpacity
            className="bg-green rounded-xl py-4 items-center mt-2"
            onPress={handleSubmit(onSubmit)}
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
      </View>
    </KeyboardAvoidingView>
  );
}
