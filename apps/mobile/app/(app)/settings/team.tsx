import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useAuthStore } from '../../../src/store/auth.store';

interface WorkspaceMember {
  id: string;
  role: string;
  status: string;
  department: string | null;
  userId: string;
  joinedAt: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    isActive: boolean;
  } | null;
}

interface WorkspaceInvitation {
  id: string;
  email: string;
  name: string | null;
  role: string;
  expiresAt: string;
  createdAt: string;
}

const ROLE_OPTIONS = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'ANALYST', 'VIEWER'] as const;
const INVITABLE_ROLES = ROLE_OPTIONS.filter((r) => r !== 'OWNER');

const ROLE_COLOR: Record<string, string> = {
  OWNER: '#f97316',
  ADMIN: '#a855f7',
  MANAGER: '#6366f1',
  AGENT: '#3b82f6',
  ANALYST: '#14b8a6',
  VIEWER: 'rgba(255,255,255,0.4)',
};

function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string | string[] } } };
  const msg = e.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

function initials(name: string): string {
  return (
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

export default function TeamScreen() {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [inviteVisible, setInviteVisible] = useState(false);
  const [actionsMember, setActionsMember] = useState<WorkspaceMember | null>(null);
  const [roleModalMember, setRoleModalMember] = useState<WorkspaceMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<(typeof ROLE_OPTIONS)[number]>('AGENT');
  const [inviting, setInviting] = useState(false);

  const { data: members, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['workspace', 'members'],
    queryFn: () => apiClient.workspace.listMembers().then((r) => r.data as WorkspaceMember[]),
  });

  const { data: invitations, refetch: refetchInvitations } = useQuery({
    queryKey: ['workspace', 'invitations'],
    queryFn: () => apiClient.workspace.listInvitations().then((r) => r.data as WorkspaceInvitation[]),
  });

  const editRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => apiClient.workspace.editMember(id, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace', 'members'] });
      setRoleModalMember(null);
    },
    onError: (e) => Alert.alert('Error', apiErrorMessage(e, 'Failed to update role')),
  });

  const suspendMember = useMutation({
    mutationFn: (id: string) => apiClient.workspace.suspendMember(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workspace', 'members'] }),
    onError: (e) => Alert.alert('Error', apiErrorMessage(e, 'Failed to suspend member')),
  });

  const reactivateMember = useMutation({
    mutationFn: (id: string) => apiClient.workspace.reactivateMember(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workspace', 'members'] }),
    onError: (e) => Alert.alert('Error', apiErrorMessage(e, 'Failed to reactivate member')),
  });

  const removeMember = useMutation({
    mutationFn: (id: string) => apiClient.workspace.removeMember(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workspace', 'members'] }),
    onError: (e) => Alert.alert('Error', apiErrorMessage(e, 'Failed to remove member')),
  });

  const cancelInvitation = useMutation({
    mutationFn: (id: string) => apiClient.workspace.cancelInvitation(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workspace', 'invitations'] }),
  });

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    setInviting(true);
    try {
      await apiClient.workspace.invite(email, inviteRole, inviteName.trim() || undefined);
      setInviteVisible(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('AGENT');
      void refetchInvitations();
    } catch (e) {
      Alert.alert('Error', apiErrorMessage(e, 'Failed to send invite'));
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = (member: WorkspaceMember) => {
    setActionsMember(null);
    Alert.alert('Remove member', `Remove ${member.user?.name ?? 'this member'} from the workspace?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMember.mutate(member.id) },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color="#25D366" />
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1">Team</Text>
        <TouchableOpacity onPress={() => setInviteVisible(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="person-add-outline" size={22} color="#25D366" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={members ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
              void refetchInvitations();
            }}
            tintColor="#25D366"
          />
        }
        ListHeaderComponent={
          invitations && invitations.length > 0 ? (
            <View className="mb-4">
              <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">
                Pending Invites
              </Text>
              <View style={{ gap: 8 }}>
                {invitations.map((inv) => (
                  <View
                    key={inv.id}
                    className="bg-surface-card border border-white/5 rounded-2xl p-3.5 flex-row items-center justify-between"
                  >
                    <View className="flex-1 min-w-0">
                      <Text className="text-white text-sm font-medium" numberOfLines={1}>
                        {inv.name || inv.email}
                      </Text>
                      <Text className="text-white/30 text-[11px] mt-0.5" numberOfLines={1}>
                        {inv.email} · {inv.role}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => cancelInvitation.mutate(inv.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle-outline" size={20} color="rgba(255,255,255,0.3)" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2 mt-4">
                Members
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View className="flex-1 items-center justify-center pt-24">
              <ActivityIndicator color="#25D366" size="large" />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const suspended = item.status === 'SUSPENDED';
          return (
            <TouchableOpacity
              className="bg-surface-card border border-white/5 rounded-2xl p-3.5 flex-row items-center gap-3"
              activeOpacity={0.8}
              onPress={() => setActionsMember(item)}
            >
              <View className="w-10 h-10 rounded-full bg-green/20 items-center justify-center">
                <Text className="text-green font-bold text-sm">{initials(item.user?.name ?? '?')}</Text>
              </View>
              <View className="flex-1 min-w-0">
                <Text className={`text-sm font-medium ${suspended ? 'text-white/40' : 'text-white'}`} numberOfLines={1}>
                  {item.user?.name ?? 'Unknown'}
                </Text>
                <Text className="text-white/30 text-[11px] mt-0.5" numberOfLines={1}>
                  {item.user?.email}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-[11px] font-semibold" style={{ color: ROLE_COLOR[item.role] ?? '#fff' }}>
                  {item.role}
                </Text>
                {suspended && <Text className="text-red-400 text-[10px] mt-0.5">Suspended</Text>}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Invite modal */}
      <Modal visible={inviteVisible} animationType="slide" transparent onRequestClose={() => setInviteVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <View className="bg-surface rounded-t-3xl">
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-white/5">
              <Text className="text-white font-bold text-lg">Invite Member</Text>
              <TouchableOpacity onPress={() => setInviteVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>
            <View className="px-5 py-4" style={{ gap: 14 }}>
              <View>
                <Text className="text-white/50 text-xs font-medium mb-1.5">Email</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-3.5 py-3 text-white text-sm"
                  placeholder="teammate@company.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                />
              </View>
              <View>
                <Text className="text-white/50 text-xs font-medium mb-1.5">Name (optional)</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-3.5 py-3 text-white text-sm"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={inviteName}
                  onChangeText={setInviteName}
                />
              </View>
              <View>
                <Text className="text-white/50 text-xs font-medium mb-2">Role</Text>
                <View className="flex-row flex-wrap gap-2">
                  {INVITABLE_ROLES.map((r) => (
                    <TouchableOpacity
                      key={r}
                      onPress={() => setInviteRole(r)}
                      className={`px-3 py-1.5 rounded-full border ${
                        inviteRole === r ? 'bg-green border-green' : 'border-white/10'
                      }`}
                    >
                      <Text className={`text-xs font-medium ${inviteRole === r ? 'text-white' : 'text-white/50'}`}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <TouchableOpacity
                className="bg-green rounded-xl py-3.5 items-center mt-2"
                onPress={handleInvite}
                disabled={inviting}
                activeOpacity={0.85}
              >
                {inviting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold">Send Invite</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Member actions sheet */}
      <Modal
        visible={!!actionsMember}
        animationType="slide"
        transparent
        onRequestClose={() => setActionsMember(null)}
      >
        <TouchableOpacity
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          activeOpacity={1}
          onPress={() => setActionsMember(null)}
        >
          <View className="bg-surface rounded-t-3xl p-5" onStartShouldSetResponder={() => true}>
            <Text className="text-white font-bold text-base mb-0.5">{actionsMember?.user?.name}</Text>
            <Text className="text-white/40 text-xs mb-4">{actionsMember?.user?.email}</Text>

            {actionsMember?.userId === currentUserId || actionsMember?.role === 'OWNER' ? (
              <Text className="text-white/40 text-sm py-3">
                Role: {actionsMember?.role} · {actionsMember?.userId === currentUserId ? 'This is you' : 'Workspace owner'}
              </Text>
            ) : (
              <>
                <TouchableOpacity
                  className="flex-row items-center gap-3 py-3"
                  onPress={() => {
                    setRoleModalMember(actionsMember);
                    setActionsMember(null);
                  }}
                >
                  <Ionicons name="swap-horizontal-outline" size={18} color="#fff" />
                  <Text className="text-white text-sm">Change Role</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-row items-center gap-3 py-3"
                  onPress={() => {
                    if (!actionsMember) return;
                    const suspended = actionsMember.status === 'SUSPENDED';
                    setActionsMember(null);
                    if (suspended) reactivateMember.mutate(actionsMember.id);
                    else suspendMember.mutate(actionsMember.id);
                  }}
                >
                  <Ionicons
                    name={actionsMember?.status === 'SUSPENDED' ? 'shield-checkmark-outline' : 'shield-outline'}
                    size={18}
                    color="#fff"
                  />
                  <Text className="text-white text-sm">
                    {actionsMember?.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-row items-center gap-3 py-3"
                  onPress={() => actionsMember && handleRemove(actionsMember)}
                >
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  <Text className="text-red-400 text-sm">Remove from Workspace</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity className="items-center py-3 mt-1" onPress={() => setActionsMember(null)}>
              <Text className="text-white/40 text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Change role modal */}
      <Modal
        visible={!!roleModalMember}
        animationType="fade"
        transparent
        onRequestClose={() => setRoleModalMember(null)}
      >
        <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View className="bg-surface rounded-2xl p-5 w-full">
            <Text className="text-white font-bold text-base mb-4">
              Change role for {roleModalMember?.user?.name}
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {INVITABLE_ROLES.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => roleModalMember && editRole.mutate({ id: roleModalMember.id, role: r })}
                  className={`px-3 py-1.5 rounded-full border ${
                    roleModalMember?.role === r ? 'bg-green border-green' : 'border-white/10'
                  }`}
                  disabled={editRole.isPending}
                >
                  <Text className={`text-xs font-medium ${roleModalMember?.role === r ? 'text-white' : 'text-white/50'}`}>
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setRoleModalMember(null)} className="items-center py-2">
              <Text className="text-white/50 text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
