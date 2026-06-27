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
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@whatsapp-platform/validation';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    try {
      const res = await apiClient.auth.login(data.email, data.password);
      const { user, tenant, accessToken } = res.data;
      setAuth(user, tenant, accessToken);
      router.replace('/(app)');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed. Please check your credentials.';
      Alert.alert('Login Failed', msg);
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
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
