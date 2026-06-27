import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

export default function ContactsScreen() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () =>
      apiClient.contacts
        .list({ search, limit: 40 })
        .then((r) => r.data.data ?? r.data),
  });

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5">
        <Text className="text-white text-xl font-bold mb-3">Contacts</Text>
        <TextInput
          className="bg-surface-card rounded-xl px-4 py-2.5 text-white text-sm"
          placeholder="Search contacts..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              className="flex-row items-center px-4 py-3 border-b border-white/5"
              activeOpacity={0.7}
            >
              <View className="w-10 h-10 rounded-full bg-blue-500/20 items-center justify-center mr-3">
                <Text className="text-blue-400 font-bold">
                  {(item.name ?? item.phone).charAt(0).toUpperCase()}
                </Text>
              </View>
              <View>
                <Text className="text-white font-semibold text-sm">
                  {item.name ?? item.phone}
                </Text>
                {item.name && (
                  <Text className="text-white/40 text-xs">{item.phone}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="items-center pt-20">
              <Text className="text-white/30">No contacts found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
