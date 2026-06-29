import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
} from 'react-native';
import { router, useLocalSearchParams, Redirect } from 'expo-router';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';
import type { AuthUser, AuthTenant, WorkspaceEntry } from '@whatsapp-platform/auth';

export default function WorkspaceSelectScreen() {
  const { tempToken, workspaces: workspacesJson } = useLocalSearchParams<{
    tempToken: string;
    workspaces: string;
  }>();

  if (!tempToken || !workspacesJson) {
    return <Redirect href="/(auth)/login" />;
  }

  const workspaces = JSON.parse(workspacesJson) as WorkspaceEntry[];
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleSelect = async (workspace: WorkspaceEntry) => {
    if (loadingId) return;
    setLoadingId(workspace.id);
    try {
      const res = await apiClient.auth.selectWorkspace(tempToken, workspace.id);
      const { user, tenant, accessToken } = res.data as {
        user: AuthUser;
        tenant: AuthTenant;
        accessToken: string;
      };
      setAuth(user, tenant, accessToken);
      router.replace('/(app)');
    } catch {
      Alert.alert('Error', 'Failed to select workspace. Please try again.');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 px-6 pt-12">
        <TouchableOpacity className="mb-8" onPress={() => router.back()}>
          <Text className="text-green text-base">← Back</Text>
        </TouchableOpacity>

        <Text className="text-white text-3xl font-bold mb-2">Choose Workspace</Text>
        <Text className="text-white/60 text-base mb-8">
          You have access to multiple workspaces. Select one to continue.
        </Text>

        <FlatList
          data={workspaces}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              className="bg-surface-card border border-white/10 rounded-xl px-5 py-4 flex-row items-center justify-between"
              onPress={() => handleSelect(item)}
              activeOpacity={0.7}
              disabled={loadingId !== null}
            >
              <View className="flex-1">
                <Text className="text-white font-semibold text-base">{item.name}</Text>
                <Text className="text-white/40 text-xs mt-0.5 capitalize">{item.role?.toLowerCase() ?? ''}</Text>
              </View>
              {loadingId === item.id ? (
                <ActivityIndicator color="#25D366" size="small" />
              ) : (
                <Text className="text-white/30 text-lg">›</Text>
              )}
            </TouchableOpacity>
          )}
        />
      </View>
    </SafeAreaView>
  );
}
