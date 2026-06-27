import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';
import type { AuthUser, AuthTenant } from '@whatsapp-platform/auth';

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function VerifyPinScreen() {
  const { tempToken, mode } = useLocalSearchParams<{
    tempToken: string;
    mode: 'verify' | 'setup';
  }>();
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  const isSetup = mode === 'setup';

  const handleKey = (key: string) => {
    if (key === '⌫') {
      setPin((prev) => prev.slice(0, -1));
      return;
    }
    if (key === '' || pin.length >= 6) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 6) {
      submitPin(next);
    }
  };

  const submitPin = async (code: string) => {
    setIsLoading(true);
    try {
      const res = isSetup
        ? await apiClient.auth.setupPin(tempToken, code)
        : await apiClient.auth.verify2FA(tempToken, code);
      const { user, tenant, accessToken } = res.data as {
        user: AuthUser;
        tenant: AuthTenant;
        accessToken: string;
      };
      setAuth(user, tenant, accessToken);
      router.replace('/(app)');
    } catch {
      Alert.alert('Invalid PIN', 'The PIN you entered is incorrect. Please try again.');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 px-6 pt-12">
        <TouchableOpacity className="mb-10" onPress={() => router.back()}>
          <Text className="text-green text-base">← Back</Text>
        </TouchableOpacity>

        <Text className="text-white text-3xl font-bold mb-2">
          {isSetup ? 'Create PIN' : 'Enter PIN'}
        </Text>
        <Text className="text-white/60 text-base mb-10">
          {isSetup
            ? 'Set a 6-digit PIN to secure your account.'
            : 'Enter your 6-digit PIN to continue.'}
        </Text>

        {/* PIN dots */}
        <View className="flex-row justify-center gap-4 mb-12">
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              className={`w-4 h-4 rounded-full ${
                i < pin.length ? 'bg-green' : 'bg-white/20'
              }`}
            />
          ))}
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#25D366" size="large" />
          </View>
        ) : (
          <View className="flex-row flex-wrap justify-center gap-4">
            {NUMPAD.map((key, i) => (
              <TouchableOpacity
                key={i}
                className={`w-20 h-16 rounded-2xl items-center justify-center ${
                  key === '' ? 'opacity-0' : 'bg-surface-card active:bg-white/10'
                }`}
                onPress={() => key !== '' && handleKey(key)}
                disabled={key === ''}
                activeOpacity={0.6}
              >
                <Text className="text-white text-2xl font-medium">{key}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
