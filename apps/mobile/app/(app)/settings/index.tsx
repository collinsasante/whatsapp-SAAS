import React from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../../src/store/auth.store';
import { apiClient } from '../../../src/lib/api';
import { useQuery } from '@tanstack/react-query';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

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
            // ignore
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
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.25)" />
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
            icon="person-outline"
            label="Edit Profile"
            onPress={() => router.push('/(app)/settings/edit-profile')}
          />
          <SettingRow
            icon="lock-closed-outline"
            label="Change PIN"
            onPress={() => router.push('/(app)/settings/change-pin')}
          />
          <SettingRow
            icon="card-outline"
            label="Billing & Subscription"
            onPress={() => router.push('/(app)/billing')}
            accent
          />
        </View>

        {/* Channels & Integrations */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="Channels & Integrations" />
          <SettingRow
            icon="logo-whatsapp"
            iconColor="#25D366"
            label="Channels"
            description="Manage WhatsApp, Telegram & more"
            onPress={() => router.push('/(app)/channels')}
          />
          <SettingRow
            icon="call-outline"
            iconColor="#3b82f6"
            label="Calls"
            description="View call history & logs"
            onPress={() => router.push('/(app)/calls')}
          />
        </View>

        {/* AI & Automation */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="AI & Automation" />
          <SettingRow
            icon="sparkles"
            iconColor="#a855f7"
            label="Verz AI"
            description="Configure AI & knowledge base"
            onPress={() => router.push('/(app)/ai')}
          />
          <SettingRow
            icon="flash-outline"
            iconColor="#f97316"
            label="Automation"
            description="Rules & workflow automation"
            onPress={() => router.push('/(app)/automation')}
          />
          <SettingRow
            icon="git-network-outline"
            iconColor="#06b6d4"
            label="Chatbot Flows"
            description="Manage conversational flows"
            onPress={() => router.push('/(app)/chatbot')}
          />
        </View>

        {/* Content */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="Content" />
          <SettingRow
            icon="images-outline"
            iconColor="#ec4899"
            label="Media Library"
            description="Team & customer files"
            onPress={() => router.push('/(app)/library')}
          />
          <SettingRow
            icon="document-text-outline"
            label="Message Templates"
            description="WhatsApp approved templates"
            onPress={() => router.push('/(app)/settings/templates')}
          />
        </View>

        {/* Reports */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="Reports" />
          <SettingRow
            icon="bar-chart-outline"
            iconColor="#10b981"
            label="Analytics"
            description="Team performance & trends"
            onPress={() => router.push('/(app)/analytics')}
          />
        </View>

        {/* Tools */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <SectionHeader title="Tools" />
          <SettingRow
            icon="notifications-outline"
            label="Notifications"
            onPress={() => router.push('/(app)/settings/notifications')}
            badge={unreadCount && unreadCount > 0 ? unreadCount : undefined}
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
  icon,
  iconColor,
  label,
  description,
  onPress,
  badge,
  accent,
}: {
  icon: IoniconName;
  iconColor?: string;
  label: string;
  description?: string;
  onPress: () => void;
  badge?: number;
  accent?: boolean;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3.5 border-b border-white/5 last:border-0 gap-3"
      onPress={onPress}
      activeOpacity={0.7}
    >
      {iconColor ? (
        <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: iconColor + '20' }}>
          <Ionicons name={icon} size={15} color={iconColor} />
        </View>
      ) : (
        <Ionicons name={icon} size={18} color="rgba(255,255,255,0.4)" />
      )}
      <View className="flex-1 min-w-0">
        <Text className={`text-sm ${accent ? 'text-green font-semibold' : 'text-white'}`}>{label}</Text>
        {description && (
          <Text className="text-white/30 text-xs mt-0.5" numberOfLines={1}>{description}</Text>
        )}
      </View>
      <View className="flex-row items-center gap-2">
        {badge != null && (
          <View className="bg-green rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
            <Text className="text-white text-[10px] font-bold">
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.25)" />
      </View>
    </TouchableOpacity>
  );
}
