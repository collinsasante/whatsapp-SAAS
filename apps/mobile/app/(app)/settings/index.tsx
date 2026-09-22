import React from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getPermissions } from '@whatsapp-platform/auth';
import { useAuthStore } from '../../../src/store/auth.store';
import { apiClient } from '../../../src/lib/api';
import { Avatar } from '../../../src/components/ui';
import { useAppTheme } from '../../../src/theme/useAppTheme';
import type { ThemePreference } from '../../../src/theme/themeStorage';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IoniconName }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

// Settings is a primary tab, not a hub of hubs -- content lives directly here,
// styled as native iOS grouped-list sections (label + divider), not cards.
export default function SettingsScreen() {
  const { user, tenant, clearAuth } = useAuthStore();
  const permissions = getPermissions(user?.role);
  const { colors, preference, setPreference } = useAppTheme();

  const { data: unreadCount } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () =>
      apiClient.notifications.unreadCount().then((r) => (r.data as { count: number }).count ?? 0),
    refetchInterval: 30000,
  });

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try { await apiClient.auth.logout(); } catch { /* ignore */ }
          clearAuth();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="px-4 py-3">
        <Text className="text-light-text-primary dark:text-white text-2xl font-bold">Settings</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Profile row */}
        <TouchableOpacity
          className="flex-row items-center px-4 py-3 gap-3"
          onPress={() => router.push('/(app)/settings/edit-profile')}
          activeOpacity={0.7}
        >
          <Avatar name={user?.name ?? '?'} size="lg" />
          <View className="flex-1 min-w-0">
            <Text className="text-light-text-primary dark:text-white font-semibold text-base" numberOfLines={1}>{user?.name}</Text>
            <Text className="text-light-text-muted dark:text-white/40 text-sm" numberOfLines={1}>{user?.email}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
        </TouchableOpacity>

        <GroupedSection title="Account">
          <Row icon="person-outline" label="Edit Profile" onPress={() => router.push('/(app)/settings/edit-profile')} />
          <Row icon="lock-closed-outline" label="Change PIN" onPress={() => router.push('/(app)/settings/change-pin')} last />
        </GroupedSection>

        <GroupedSection title="Workspace">
          <View className="px-4 py-3 border-b border-light-border dark:border-white/5">
            <Text className="text-light-text-primary dark:text-white text-[15px]">{tenant?.name}</Text>
            <Text className="text-light-text-muted dark:text-white/35 text-xs mt-0.5 capitalize">{tenant?.plan ?? 'Free'} plan</Text>
          </View>
          {permissions.canManageTeam && (
            <Row icon="people-outline" label="Team" onPress={() => router.push('/(app)/settings/team')} />
          )}
          {permissions.showBilling && (
            <Row icon="card-outline" label="Billing & Subscription" onPress={() => router.push('/(app)/billing')} last />
          )}
        </GroupedSection>

        <GroupedSection title="Notifications">
          <Row
            icon="notifications-outline"
            label="Notifications"
            badge={unreadCount && unreadCount > 0 ? unreadCount : undefined}
            onPress={() => router.push('/(app)/settings/notifications')}
          />
          <Row icon="phone-portrait-outline" label="Push Notifications" onPress={() => router.push('/(app)/settings/push-preferences')} last />
        </GroupedSection>

        <GroupedSection title="Appearance">
          <View className="flex-row gap-2 px-4 py-3">
            {THEME_OPTIONS.map((opt) => {
              const active = preference === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setPreference(opt.value)}
                  activeOpacity={0.8}
                  className={`flex-1 items-center gap-1.5 py-3 rounded-xl border ${
                    active ? 'bg-green/15 border-green/30' : 'bg-light-elevated dark:bg-surface-elevated border-light-border dark:border-white/5'
                  }`}
                >
                  <Ionicons name={opt.icon} size={18} color={active ? '#25D366' : colors.textSecondary} />
                  <Text className={`text-xs font-medium ${active ? 'text-green' : 'text-light-text-secondary dark:text-white/60'}`}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </GroupedSection>

        {permissions.showChannels && (
          <GroupedSection title="Channels">
            <Row icon="logo-whatsapp" label="Connected Channels" onPress={() => router.push('/(app)/channels')} last />
          </GroupedSection>
        )}

        {permissions.showAI && (
          <GroupedSection title="AI">
            <Row icon="sparkles-outline" label="Verz AI" onPress={() => router.push('/(app)/ai')} last />
          </GroupedSection>
        )}

        <GroupedSection title="About">
          <View className="px-4 py-3 border-b border-light-border dark:border-white/5">
            <Text className="text-light-text-muted dark:text-white/40 text-sm">VerzChat Mobile</Text>
            <Text className="text-light-text-disabled dark:text-white/20 text-xs mt-0.5">Version 1.0.0</Text>
          </View>
        </GroupedSection>

        <TouchableOpacity className="mx-4 mt-6 py-3.5 items-center" onPress={handleLogout} activeOpacity={0.7}>
          <Text className="text-red-400 font-medium text-[15px]">Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function GroupedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <Text className="text-light-text-muted dark:text-white/35 text-xs font-semibold uppercase tracking-wider px-4 mb-1.5">{title}</Text>
      {children}
    </View>
  );
}

function Row({
  icon, label, onPress, badge, last,
}: { icon: IoniconName; label: string; onPress: () => void; badge?: number; last?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      className={`flex-row items-center px-4 py-3 gap-3 ${last ? '' : 'border-b border-light-border dark:border-white/5'}`}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={19} color={colors.textSecondary} style={{ width: 22 }} />
      <Text className="flex-1 text-light-text-primary dark:text-white text-[15px]">{label}</Text>
      {badge != null && (
        <View className="bg-green rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
          <Text className="text-white text-[10px] font-bold">{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
    </TouchableOpacity>
  );
}
