import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getPermissions } from '@whatsapp-platform/auth';
import { useAuthStore } from '../../src/store/auth.store';
import { useAppTheme } from '../../src/theme/useAppTheme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Item {
  icon: IoniconName;
  label: string;
  description: string;
  href: string;
  visible: boolean;
}

// The rest of VerzChat's workspace tools -- Commerce, Campaigns, Automation,
// Analytics, Media, Templates. Verz is a single product (VerzChat); there is
// no separate multi-product suite in this codebase, so this is a feature
// launcher for that one product, not a fake "app store."
export default function MoreScreen() {
  const role = useAuthStore((s) => s.user?.role);
  const permissions = getPermissions(role);
  const { colors } = useAppTheme();

  const items: Item[] = [
    {
      icon: 'megaphone-outline',
      label: 'Campaigns',
      description: 'Broadcast messages to your contacts',
      href: '/(app)/campaigns',
      visible: permissions.showCampaigns,
    },
    {
      icon: 'storefront-outline',
      label: 'Commerce',
      description: 'Orders and your product catalog',
      href: '/(app)/commerce',
      visible: permissions.showCommerce,
    },
    {
      icon: 'flash-outline',
      label: 'Automation',
      description: 'Rules that run on incoming messages',
      href: '/(app)/automation',
      visible: permissions.showAutomation,
    },
    {
      icon: 'git-network-outline',
      label: 'Chatbot Flows',
      description: 'Manage conversational flows',
      href: '/(app)/chatbot',
      visible: permissions.showChatbot,
    },
    {
      icon: 'bar-chart-outline',
      label: 'Analytics',
      description: 'Business activity, trends, and team performance',
      href: '/(app)/analytics',
      visible: true,
    },
    {
      icon: 'call-outline',
      label: 'Calls',
      description: 'Call history and logs',
      href: '/(app)/calls',
      visible: true,
    },
    {
      icon: 'images-outline',
      label: 'Media Library',
      description: 'Team and customer files',
      href: '/(app)/library',
      visible: true,
    },
    {
      icon: 'document-text-outline',
      label: 'Message Templates',
      description: 'WhatsApp approved templates',
      href: '/(app)/settings/templates',
      visible: permissions.showTemplates,
    },
  ].filter((i) => i.visible);

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="px-4 py-3">
        <Text className="text-light-text-primary dark:text-white text-2xl font-bold">More</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        {items.map((item, i) => (
          <TouchableOpacity
            key={item.href}
            className={`flex-row items-center px-4 py-3.5 gap-3.5 ${i === items.length - 1 ? '' : 'border-b border-light-border dark:border-white/5'}`}
            onPress={() => router.push(item.href as never)}
            activeOpacity={0.7}
          >
            <View className="w-9 h-9 rounded-lg bg-light-elevated dark:bg-white/5 items-center justify-center">
              <Ionicons name={item.icon} size={18} color={colors.textSecondary} />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-light-text-primary dark:text-white text-[15px] font-medium">{item.label}</Text>
              <Text className="text-light-text-muted dark:text-white/35 text-xs mt-0.5" numberOfLines={1}>{item.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
