import React, { useEffect } from 'react';
import { Tabs, Redirect, router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getPermissions, type Permissions } from '@whatsapp-platform/auth';
import { useAuthStore } from '../../src/store/auth.store';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({
  name,
  focused,
  color,
}: {
  name: IoniconName;
  focused: boolean;
  color: string;
}) {
  return <Ionicons name={focused ? name : (`${name}-outline` as IoniconName)} size={22} color={color} />;
}

// Screens gated behind an admin-only permission flag. Mirrors
// apps/frontend/src/app/(dashboard)/layout.tsx's canAccess() redirect --
// hiding the tab/settings row is UX only, this is the actual navigation
// guard for direct/deep-linked access, same as web. The real enforcement
// still lives server-side; this just keeps mobile's client-side behavior
// consistent with web's.
const GATED_ROUTES: Array<{ prefix: string; allowed: (p: Permissions) => boolean }> = [
  { prefix: '/settings/templates', allowed: (p) => p.showTemplates },
  { prefix: '/campaigns', allowed: (p) => p.showCampaigns },
  { prefix: '/channels', allowed: (p) => p.showChannels },
  { prefix: '/ai', allowed: (p) => p.showAI },
  { prefix: '/automation', allowed: (p) => p.showAutomation },
  { prefix: '/chatbot', allowed: (p) => p.showChatbot },
  { prefix: '/billing', allowed: (p) => p.showBilling },
];

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isReady = useAuthStore((s) => s.isReady);
  const role = useAuthStore((s) => s.user?.role);
  const pathname = usePathname();

  const permissions = getPermissions(role);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !pathname) return;
    const blocked = GATED_ROUTES.find((r) => pathname.startsWith(r.prefix) && !r.allowed(permissions));
    if (blocked) {
      router.replace('/(app)/inbox');
    }
  }, [isReady, isAuthenticated, pathname, permissions]);

  if (!isReady) return null;

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#161b22',
          borderTopColor: 'rgba(255,255,255,0.07)',
          borderTopWidth: 1,
          paddingBottom: 4,
          height: 60,
        },
        tabBarActiveTintColor: '#25D366',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.4)',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="grid" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="chatbubbles" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="people" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: 'Campaigns',
          href: permissions.showCampaigns ? undefined : null,
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="megaphone" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="settings" focused={focused} color={color} />
          ),
        }}
      />

      {/* Hidden screens — navigated from Settings, not shown in tab bar */}
      <Tabs.Screen name="channels" options={{ href: null }} />
      <Tabs.Screen name="calls" options={{ href: null }} />
      <Tabs.Screen name="library" options={{ href: null }} />
      <Tabs.Screen name="ai" options={{ href: null }} />
      <Tabs.Screen name="automation" options={{ href: null }} />
      <Tabs.Screen name="chatbot" options={{ href: null }} />
      <Tabs.Screen name="analytics" options={{ href: null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
    </Tabs>
  );
}
