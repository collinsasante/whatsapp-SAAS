import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { MessageDirection } from '@whatsapp-platform/shared-types';

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

interface Conversation {
  id: string;
  status: string;
  lastMessage?: { content: string | null; type: string; direction: string } | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  assignedTo?: { name: string } | null;
  channel?: { name: string } | null;
}

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [isStarting, setIsStarting] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => apiClient.contacts.get(id).then((r) => r.data as Contact),
    enabled: !!id,
  });

  const { data: convs } = useQuery({
    queryKey: ['contact-conversations', id],
    queryFn: () =>
      apiClient.conversations.list({ contactId: id, limit: 10 })
        .then((r) => (r.data.data ?? r.data) as Conversation[]),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.contacts.update(id, {
        name: form.name.trim() || null,
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', id] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setShowEdit(false);
    },
    onError: () => Alert.alert('Error', 'Could not update contact'),
  });

  const openEdit = () => {
    if (!contact) return;
    setForm({
      name: contact.name ?? '',
      phone: contact.phone,
      email: contact.email ?? '',
      notes: contact.notes ?? '',
    });
    setShowEdit(true);
  };

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
              qc.invalidateQueries({ queryKey: ['contact', id] });
            } catch {
              Alert.alert('Error', 'Could not update contact.');
            }
          },
        },
      ],
    );
  };

  const handleDelete = () => {
    Alert.alert('Delete Contact', 'This will permanently remove the contact.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.contacts.delete(id);
            qc.invalidateQueries({ queryKey: ['contacts'] });
            router.back();
          } catch {
            Alert.alert('Error', 'Could not delete contact.');
          }
        },
      },
    ]);
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
      <View className="flex-row items-center px-4 py-3 border-b border-white/5 gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color="#25D366" />
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1" numberOfLines={1}>
          {displayName}
        </Text>
        <TouchableOpacity onPress={openEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="pencil-outline" size={18} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Avatar */}
        <View className="items-center mb-2">
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
          className="bg-green rounded-xl py-3.5 items-center flex-row justify-center gap-2"
          onPress={startConversation}
          disabled={isStarting || contact.isBlocked}
          activeOpacity={0.8}
          style={{ opacity: contact.isBlocked ? 0.4 : 1 }}
        >
          {isStarting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="chatbubble" size={16} color="#fff" />
              <Text className="text-white font-bold text-base">Send Message</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Info card */}
        <View className="bg-surface-card rounded-2xl border border-white/5 overflow-hidden">
          <View className="px-4 py-2.5 border-b border-white/5">
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider">Contact Info</Text>
          </View>
          <InfoRow label="Phone" value={contact.phone} icon="call-outline" />
          {contact.email && <InfoRow label="Email" value={contact.email} icon="mail-outline" />}
          <InfoRow
            label="Added"
            value={new Date(contact.createdAt).toLocaleDateString([], {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            icon="calendar-outline"
          />
        </View>

        {/* Labels */}
        {contact.labels.length > 0 && (
          <View className="bg-surface-card rounded-2xl border border-white/5 p-4">
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Labels</Text>
            <View className="flex-row flex-wrap gap-2">
              {contact.labels.map((label) => (
                <View key={label} className="px-3 py-1 bg-green/15 border border-green/20 rounded-full">
                  <Text className="text-green text-xs font-medium">{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Notes */}
        {contact.notes && (
          <View className="bg-surface-card rounded-2xl border border-white/5 p-4">
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Notes</Text>
            <Text className="text-white/70 text-sm leading-5">{contact.notes}</Text>
          </View>
        )}

        {/* Conversation history */}
        {convs && convs.length > 0 && (
          <View className="bg-surface-card rounded-2xl border border-white/5 overflow-hidden">
            <View className="px-4 py-2.5 border-b border-white/5">
              <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider">
                Conversation History
              </Text>
            </View>
            {convs.map((conv, i) => {
              const lastMsg = conv.lastMessage;
              const preview = lastMsg?.content
                ?? (lastMsg?.type === 'IMAGE' ? '📷 Photo'
                  : lastMsg?.type === 'VIDEO' ? '🎬 Video'
                  : lastMsg?.type === 'AUDIO' ? '🎵 Voice'
                  : lastMsg?.type === 'DOCUMENT' ? '📄 Document'
                  : 'No messages');
              const prefix = lastMsg?.direction === MessageDirection.OUTBOUND ? 'You: ' : '';
              return (
                <TouchableOpacity
                  key={conv.id}
                  className={`flex-row items-center px-4 py-3.5 gap-3 ${i < convs.length - 1 ? 'border-b border-white/5' : ''}`}
                  onPress={() => router.push(`/(app)/inbox/${conv.id}`)}
                  activeOpacity={0.7}
                >
                  <View className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    conv.status === 'OPEN' ? 'bg-green' :
                    conv.status === 'PENDING' ? 'bg-orange-400' :
                    conv.status === 'RESOLVED' ? 'bg-blue-400' : 'bg-white/20'
                  }`} />
                  <View className="flex-1 min-w-0">
                    <Text className="text-white text-sm" numberOfLines={1}>{prefix}{preview}</Text>
                    {conv.lastMessageAt && (
                      <Text className="text-white/30 text-xs mt-0.5">
                        {new Date(conv.lastMessageAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    )}
                  </View>
                  <View className={`px-2 py-0.5 rounded-full ${
                    conv.status === 'OPEN' ? 'bg-green/15' :
                    conv.status === 'PENDING' ? 'bg-orange-500/15' :
                    conv.status === 'RESOLVED' ? 'bg-blue-500/15' : 'bg-white/5'
                  }`}>
                    <Text className={`text-[10px] font-semibold uppercase ${
                      conv.status === 'OPEN' ? 'text-green' :
                      conv.status === 'PENDING' ? 'text-orange-400' :
                      conv.status === 'RESOLVED' ? 'text-blue-400' : 'text-white/30'
                    }`}>{conv.status}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Actions */}
        <View className="gap-2 mt-2 mb-4">
          <TouchableOpacity
            className="border border-red-500/30 rounded-2xl py-3.5 items-center"
            onPress={handleBlock}
            activeOpacity={0.7}
          >
            <Text className="text-red-400 font-semibold text-sm">
              {contact.isBlocked ? 'Unblock Contact' : 'Block Contact'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="border border-red-800/30 rounded-2xl py-3.5 items-center"
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Text className="text-red-600 font-semibold text-sm">Delete Contact</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable className="flex-1 bg-black/50" onPress={() => setShowEdit(false)} />
          <View className="bg-surface rounded-t-3xl pt-5 pb-8 px-5">
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-white font-bold text-lg">Edit Contact</Text>
              <TouchableOpacity onPress={() => setShowEdit(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View className="gap-3">
                <FormField
                  label="Name"
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="Contact name..."
                  autoCapitalize="words"
                />
                <FormField
                  label="Phone"
                  value={form.phone}
                  onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                  placeholder="+1234567890"
                  keyboardType="phone-pad"
                  required
                />
                <FormField
                  label="Email"
                  value={form.email}
                  onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                  placeholder="email@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <View className="mb-2">
                  <Text className="text-white/50 text-xs mb-1.5">Notes</Text>
                  <TextInput
                    className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                    placeholder="Internal notes about this contact..."
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    value={form.notes}
                    onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    style={{ minHeight: 80 }}
                  />
                </View>
              </View>

              <TouchableOpacity
                className="bg-green rounded-2xl py-4 items-center mt-2"
                onPress={() => {
                  if (!form.phone.trim()) { Alert.alert('Required', 'Phone number is required'); return; }
                  updateMutation.mutate();
                }}
                disabled={updateMutation.isPending}
                activeOpacity={0.8}
              >
                {updateMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-base">Save Changes</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <View className="flex-row items-center px-4 py-3.5 border-b border-white/5 last:border-0 gap-3">
      <Ionicons name={icon as never} size={15} color="rgba(255,255,255,0.3)" />
      <Text className="text-white/40 text-sm w-14">{label}</Text>
      <Text className="text-white text-sm flex-1">{value}</Text>
    </View>
  );
}

function FormField({
  label, value, onChange, placeholder, required, autoCapitalize, keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
  autoCapitalize?: 'none' | 'words' | 'sentences' | 'characters';
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
}) {
  return (
    <View>
      <Text className="text-white/50 text-xs mb-1.5">
        {label} {required && <Text className="text-red-400">*</Text>}
      </Text>
      <TextInput
        className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.25)"
        value={value}
        onChangeText={onChange}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}
