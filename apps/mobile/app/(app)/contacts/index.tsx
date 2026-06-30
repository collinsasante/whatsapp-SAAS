import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () =>
      apiClient.contacts
        .list({ search: search || undefined, limit: 50 })
        .then((r) => (r.data.data ?? r.data) as Contact[]),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.contacts.create({
        name: form.name.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setShowCreate(false);
      setForm({ name: '', phone: '', email: '' });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      const text = Array.isArray(msg) ? msg[0] : msg ?? 'Could not create contact';
      Alert.alert('Error', text);
    },
  });

  const handleCreate = useCallback(() => {
    if (!form.phone.trim()) {
      Alert.alert('Required', 'Phone number is required');
      return;
    }
    createMutation.mutate();
  }, [form, createMutation]);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 pt-2 pb-3 border-b border-white/5">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-white text-xl font-bold">Contacts</Text>
          <TouchableOpacity
            onPress={() => setShowCreate(true)}
            className="w-8 h-8 bg-green rounded-full items-center justify-center"
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
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
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.2)" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="items-center pt-24 gap-3">
              <Ionicons name="people-outline" size={48} color="rgba(255,255,255,0.1)" />
              <Text className="text-white/30 text-base font-medium">
                {search ? 'No contacts match' : 'No contacts yet'}
              </Text>
              {!search && (
                <TouchableOpacity
                  onPress={() => setShowCreate(true)}
                  className="mt-2 bg-green rounded-xl px-5 py-2.5"
                >
                  <Text className="text-white font-semibold text-sm">Add First Contact</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          contentContainerStyle={{ flexGrow: 1 }}
        />
      )}

      {/* Create Contact Modal */}
      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable className="flex-1 bg-black/50" onPress={() => setShowCreate(false)} />
          <View className="bg-surface rounded-t-3xl pt-5 pb-8 px-5">
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-white font-bold text-lg">New Contact</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <View className="gap-3">
              <View>
                <Text className="text-white/50 text-xs mb-1.5">Name</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="Contact name..."
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  autoCapitalize="words"
                />
              </View>
              <View>
                <Text className="text-white/50 text-xs mb-1.5">Phone <Text className="text-red-400">*</Text></Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="+1234567890"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  value={form.phone}
                  onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                  keyboardType="phone-pad"
                />
              </View>
              <View>
                <Text className="text-white/50 text-xs mb-1.5">Email</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="email@example.com"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  value={form.email}
                  onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <TouchableOpacity
              className="bg-green rounded-2xl py-4 items-center mt-5"
              onPress={handleCreate}
              disabled={createMutation.isPending}
              activeOpacity={0.8}
            >
              {createMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-bold text-base">Create Contact</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
