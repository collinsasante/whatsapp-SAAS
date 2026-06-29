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
import { forgotPasswordSchema, type ForgotPasswordInput } from '@whatsapp-platform/validation';
import { apiClient } from '../../src/lib/api';

export default function ForgotPasswordScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setIsLoading(true);
    try {
      await apiClient.auth.forgotPassword(data.email);
      setSent(true);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <View className="flex-1 bg-surface justify-center px-6">
        <Text className="text-white text-2xl font-bold mb-3">Check your email</Text>
        <Text className="text-white/60 text-base mb-8">
          We sent a password reset link to your email address.
        </Text>
        <TouchableOpacity
          className="bg-surface-card border border-white/10 rounded-xl py-4 items-center"
          onPress={() => router.back()}
        >
          <Text className="text-white font-semibold">Back to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-surface"
    >
      <View className="flex-1 justify-center px-6">
        <TouchableOpacity className="mb-8" onPress={() => router.back()}>
          <Text className="text-green text-base">← Back</Text>
        </TouchableOpacity>

        <Text className="text-white text-3xl font-bold mb-2">Reset Password</Text>
        <Text className="text-white/60 text-base mb-8">
          Enter your email and we'll send a reset link.
        </Text>

        <View className="gap-4">
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
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
              />
            )}
          />
          {errors.email && (
            <Text className="text-red-400 text-xs">{errors.email.message}</Text>
          )}

          <TouchableOpacity
            className="bg-green rounded-xl py-4 items-center"
            onPress={handleSubmit(onSubmit)}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-bold text-base">Send Reset Link</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
