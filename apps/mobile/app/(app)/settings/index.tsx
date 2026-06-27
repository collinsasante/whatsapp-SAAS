import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../../src/store/auth.store';
import { apiClient } from '../../../src/lib/api';

export default function SettingsScreen() {
  const { user, tenant, clearAuth } = useAuthStore();

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.auth.logout();
          } catch {
            // ignore — clear local state regardless
          }
          clearAuth();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5">
        <Text className="text-white text-xl font-bold">Settings</Text>
      </View>

      <View className="flex-1 px-4 pt-6">
        {/* Profile card */}
        <View className="bg-surface-card rounded-2xl p-4 border border-white/5 mb-6">
          <View className="flex-row items-center gap-4">
            <View className="w-14 h-14 rounded-full bg-green/20 items-center justify-center">
              <Text className="text-green font-extrabold text-xl">
                {user?.name?.charAt(0).toUpperCase() ?? '?'}
              </Text>
            </View>
            <View>
              <Text className="text-white font-bold text-base">{user?.name}</Text>
              <Text className="text-white/50 text-sm">{user?.email}</Text>
              <Text className="text-green text-xs font-semibold mt-0.5">{user?.role}</Text>
            </View>
          </View>
        </View>

        {/* Workspace */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-6 overflow-hidden">
          <View className="px-4 py-3 border-b border-white/5">
            <Text className="text-white/50 text-xs font-semibold uppercase tracking-wider">
              Workspace
            </Text>
          </View>
          <View className="px-4 py-3">
            <Text className="text-white font-semibold">{tenant?.name}</Text>
            <Text className="text-white/40 text-xs mt-0.5">{tenant?.plan ?? 'Free'} plan</Text>
          </View>
        </View>

        {/* Actions */}
        <View className="bg-surface-card rounded-2xl border border-white/5 overflow-hidden">
          <SettingRow label="Profile" onPress={() => {}} />
          <SettingRow label="Notifications" onPress={() => {}} />
          <SettingRow label="Security" onPress={() => {}} />
          <SettingRow label="About" onPress={() => {}} />
        </View>

        {/* Logout */}
        <TouchableOpacity
          className="mt-6 border border-red-500/30 rounded-2xl py-4 items-center"
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text className="text-red-400 font-semibold">Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SettingRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      className="flex-row items-center justify-between px-4 py-3.5 border-b border-white/5 last:border-0"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text className="text-white text-sm">{label}</Text>
      <Text className="text-white/30">›</Text>
    </TouchableOpacity>
  );
}
