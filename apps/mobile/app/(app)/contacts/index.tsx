import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  labels: string[];
  isBlocked: boolean;
}

export default function ContactsScreen() {
  const [search, setSearch] = useState('');

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () =>
      apiClient.contacts
        .list({ search: search || undefined, limit: 50 })
        .then((r) => (r.data.data ?? r.data) as Contact[]),
  });

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 pt-2 pb-3 border-b border-white/5">
        <Text className="text-white text-xl font-bold mb-3">Contacts</Text>
        <TextInput
          className="bg-surface-card border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm"
          placeholder="Search by name or phone..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#25D366" />
          }
          renderItem={({ item }) => {
            const displayName = item.name ?? item.phone;
            const initials = displayName.charAt(0).toUpperCase();
            return (
              <TouchableOpacity
                className="flex-row items-center px-4 py-3.5 border-b border-white/5"
                onPress={() => router.push(`/(app)/contacts/${item.id}`)}
                activeOpacity={0.7}
              >
                <View className="w-11 h-11 rounded-full bg-blue-500/15 items-center justify-center mr-3 border border-blue-500/20">
                  <Text className="text-blue-400 font-bold text-base">{initials}</Text>
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-white font-semibold text-sm" numberOfLines={1}>
                    {displayName}
                  </Text>
                  {item.name && (
                    <Text className="text-white/40 text-xs mt-0.5">{item.phone}</Text>
                  )}
                  {item.isBlocked && (
                    <Text className="text-red-400 text-xs mt-0.5">Blocked</Text>
                  )}
                </View>
                {item.labels.length > 0 && (
                  <Text className="text-white/20 text-xs ml-2 max-w-[80px]" numberOfLines={1}>
                    {item.labels[0]}
                    {item.labels.length > 1 ? ` +${item.labels.length - 1}` : ''}
                  </Text>
                )}
                <Text className="text-white/20 ml-2">›</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="items-center pt-24">
              <Text className="text-white/20 text-4xl mb-3">👥</Text>
              <Text className="text-white/30 text-base font-medium">
                {search ? 'No contacts match' : 'No contacts yet'}
              </Text>
            </View>
          }
          contentContainerStyle={{ flexGrow: 1 }}
        />
      )}
    </SafeAreaView>
  );
}
