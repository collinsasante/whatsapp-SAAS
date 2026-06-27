import React from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../../src/store/auth.store';
import { apiClient } from '../../../src/lib/api';
import { useQuery } from '@tanstack/react-query';

export default function SettingsScreen() {
  const { user, tenant, clearAuth } = useAuthStore();

  const { data: unreadCount } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () =>
      apiClient.notifications
        .unreadCount()
        .then((r) => (r.data as { count: number }).count ?? 0),
    refetchInterval: 30000,
  });

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

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Profile card */}
        <TouchableOpacity
          className="bg-surface-card rounded-2xl p-4 border border-white/5 mb-4 flex-row items-center gap-4"
          onPress={() => router.push('/(app)/settings/edit-profile')}
          activeOpacity={0.8}
        >
          <View className="w-14 h-14 rounded-full bg-green/20 items-center justify-center">
            <Text className="text-green font-extrabold text-xl">
              {user?.name?.charAt(0).toUpperCase() ?? '?'}
            </Text>
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-white font-bold text-base" numberOfLines={1}>{user?.name}</Text>
            <Text className="text-white/50 text-sm" numberOfLines={1}>{user?.email}</Text>
            <Text className="text-green text-xs font-semibold mt-0.5 capitalize">
              {user?.role?.toLowerCase().replace(/_/g, ' ')}
            </Text>
          </View>
          <Text className="text-white/30">›</Text>
        </TouchableOpacity>

        {/* Workspace */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="Workspace" />
          <View className="px-4 py-3">
            <Text className="text-white font-semibold">{tenant?.name}</Text>
            <Text className="text-white/40 text-xs mt-0.5 capitalize">
              {tenant?.plan ?? 'Free'} plan
            </Text>
          </View>
        </View>

        {/* Account */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="Account" />
          <SettingRow
            label="Edit Profile"
            onPress={() => router.push('/(app)/settings/edit-profile')}
          />
          <SettingRow
            label="Change PIN"
            onPress={() => router.push('/(app)/settings/change-pin')}
          />
        </View>

        {/* Tools */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="Tools" />
          <SettingRow
            label="Notifications"
            onPress={() => router.push('/(app)/settings/notifications')}
            badge={unreadCount && unreadCount > 0 ? unreadCount : undefined}
          />
          <SettingRow
            label="Message Templates"
            onPress={() => router.push('/(app)/settings/templates')}
          />
        </View>

        {/* About */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-6 overflow-hidden">
          <SectionHeader title="About" />
          <View className="px-4 py-3 border-b border-white/5">
            <Text className="text-white/40 text-sm">VerzChat Mobile</Text>
            <Text className="text-white/20 text-xs mt-0.5">Version 1.0.0</Text>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity
          className="border border-red-500/30 rounded-2xl py-4 items-center"
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text className="text-red-400 font-semibold">Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View className="px-4 py-2.5 border-b border-white/5">
      <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider">{title}</Text>
    </View>
  );
}

function SettingRow({
  label,
  onPress,
  badge,
}: {
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center justify-between px-4 py-3.5 border-b border-white/5 last:border-0"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text className="text-white text-sm">{label}</Text>
      <View className="flex-row items-center gap-2">
        {badge != null && (
          <View className="bg-green rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
            <Text className="text-white text-[10px] font-bold">
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
        <Text className="text-white/30">›</Text>
      </View>
    </TouchableOpacity>
  );
}
