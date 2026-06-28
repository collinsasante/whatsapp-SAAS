import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
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
  notes: string | null;
  isBlocked: boolean;
  createdAt: string;
}

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [isStarting, setIsStarting] = useState(false);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => apiClient.contacts.get(id).then((r) => r.data as Contact),
    enabled: !!id,
  });

  const startConversation = async () => {
    if (!id || isStarting) return;
    setIsStarting(true);
    try {
      const res = await apiClient.conversations.findOrCreate(id);
      const conversationId = (res.data as { id: string }).id;
      router.push(`/(app)/inbox/${conversationId}`);
    } catch {
      Alert.alert('Error', 'Could not start conversation. Please try again.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleBlock = () => {
    if (!contact) return;
    Alert.alert(
      contact.isBlocked ? 'Unblock Contact' : 'Block Contact',
      contact.isBlocked
        ? `Allow messages from ${contact.name ?? contact.phone}?`
        : `Block messages from ${contact.name ?? contact.phone}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: contact.isBlocked ? 'Unblock' : 'Block',
          style: contact.isBlocked ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await apiClient.contacts.block(id);
              router.back();
            } catch {
              Alert.alert('Error', 'Could not update contact.');
            }
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!contact) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center">
        <Text className="text-white/40">Contact not found</Text>
      </SafeAreaView>
    );
  }

  const displayName = contact.name ?? contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text className="text-green text-base">←</Text>
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1" numberOfLines={1}>
          {displayName}
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Avatar */}
        <View className="items-center mb-6">
          <View className="w-24 h-24 rounded-full bg-blue-500/20 items-center justify-center border-2 border-blue-500/30 mb-3">
            <Text className="text-blue-400 font-extrabold text-4xl">{initials}</Text>
          </View>
          <Text className="text-white text-xl font-bold">{displayName}</Text>
          {contact.isBlocked && (
            <View className="mt-1.5 px-3 py-0.5 bg-red-500/20 rounded-full">
              <Text className="text-red-400 text-xs font-semibold">Blocked</Text>
            </View>
          )}
        </View>

        {/* Start conversation */}
        <TouchableOpacity
          className="bg-green rounded-xl py-3.5 items-center mb-4"
          onPress={startConversation}
          disabled={isStarting || contact.isBlocked}
          activeOpacity={0.8}
          style={{ opacity: contact.isBlocked ? 0.4 : 1 }}
        >
          {isStarting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text className="text-white font-bold text-base">Start Conversation</Text>
          )}
        </TouchableOpacity>

        {/* Info card */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <InfoRow label="Phone" value={contact.phone} />
          {contact.email && <InfoRow label="Email" value={contact.email} />}
          <InfoRow
            label="Added"
            value={new Date(contact.createdAt).toLocaleDateString([], {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          />
        </View>

        {/* Labels */}
        {contact.labels.length > 0 && (
          <View className="bg-surface-card rounded-2xl border border-white/5 p-4 mb-4">
            <Text className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">
              Labels
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {contact.labels.map((label) => (
                <View key={label} className="px-3 py-1 bg-white/8 rounded-full">
                  <Text className="text-white/70 text-xs">{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Notes */}
        {contact.notes && (
          <View className="bg-surface-card rounded-2xl border border-white/5 p-4 mb-4">
            <Text className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
              Notes
            </Text>
            <Text className="text-white/70 text-sm leading-5">{contact.notes}</Text>
          </View>
        )}

        {/* Block action */}
        <TouchableOpacity
          className="border border-red-500/30 rounded-2xl py-3.5 items-center mt-2"
          onPress={handleBlock}
          activeOpacity={0.7}
        >
          <Text className="text-red-400 font-semibold text-sm">
            {contact.isBlocked ? 'Unblock Contact' : 'Block Contact'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center px-4 py-3.5 border-b border-white/5 last:border-0">
      <Text className="text-white/40 text-sm w-16">{label}</Text>
      <Text className="text-white text-sm flex-1">{value}</Text>
    </View>
  );
}
