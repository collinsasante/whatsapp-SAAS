import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../src/lib/api';
import { useAuthStore } from '../../../../src/store/auth.store';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Workspace membership roles -- distinct from the 4-value UserRole enum used
// for JWT/session permissions. No shared type exists for this yet (see
// apps/backend/src/workspace/workspace.service.ts's WORKSPACE_ROLES and
// apps/frontend/src/components/shared/TeamManagement.tsx's ROLE_OPTIONS,
// which this mirrors).
type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'ANALYST' | 'VIEWER';
const WORKSPACE_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'ANALYST', 'VIEWER'];
const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  AGENT: 'Agent',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};

interface MemberUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  phone?: string | null;
  isActive: boolean;
  lastSeenAt?: string | null;
  lastLoginAt?: string | null;
}

interface Member {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: 'ACTIVE' | 'SUSPENDED';
  department?: string | null;
  joinedAt?: string | null;
  createdAt: string;
  user: MemberUser | null;
}

interface Invitation {
  id: string;
  email: string;
  name?: string | null;
  role: WorkspaceRole;
  expiresAt: string;
}

interface ActivityStats {
  member: Member;
  stats: {
    assignedConversations: number;
    resolvedConversations: number;
    sentMessages: number;
    notesAdded: number;
  };
}

function unwrap<T>(raw: unknown): T {
  if (Array.isArray(raw)) return raw as T;
  if (raw && typeof raw === 'object' && 'data' in (raw as object)) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

function getErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg[0] ?? fallback;
  return msg ?? fallback;
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return 'Never';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TeamScreen() {
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; link: string } | null>(null);

  const {
    data: members,
    isLoading: membersLoading,
    isRefetching,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: ['workspace', 'members'],
    queryFn: () => apiClient.workspace.listMembers().then((r) => unwrap<Member[]>(r.data)),
  });

  const { data: invitations, refetch: refetchInvitations } = useQuery({
    queryKey: ['workspace', 'invitations'],
    queryFn: () => apiClient.workspace.listInvitations().then((r) => unwrap<Invitation[]>(r.data)),
  });

  const refetchAll = () => {
    refetchMembers();
    refetchInvitations();
  };

  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; role: WorkspaceRole; name?: string }) =>
      apiClient.workspace.invite(data.email, data.role, data.name),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['workspace'] });
      const link = (res.data as { link?: string })?.link;
      setInviteResult({ email: vars.email, link: link ?? '' });
    },
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to send invite.')),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (id: string) => apiClient.workspace.cancelInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', 'invitations'] }),
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to cancel invite.')),
  });

  const editMutation = useMutation({
    mutationFn: (data: { name: string; email: string; phone: string; department: string; role: WorkspaceRole }) =>
      apiClient.workspace.editMember(selectedMember!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace', 'members'] });
      setShowEdit(false);
      setSelectedMember(null);
    },
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to update member.')),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => apiClient.workspace.suspendMember(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', 'members'] }),
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to suspend member.')),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.workspace.reactivateMember(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', 'members'] }),
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to reactivate member.')),
  });

  const forceLogoutMutation = useMutation({
    mutationFn: (id: string) => apiClient.workspace.forceLogout(id),
    onSuccess: () => Alert.alert('Done', 'This member has been signed out of all sessions.'),
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to force logout.')),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (newPassword: string) => apiClient.workspace.resetPassword(selectedMember!.id, newPassword),
    onSuccess: () => {
      setShowResetPassword(false);
      setSelectedMember(null);
      Alert.alert('Done', 'Password has been reset and the member has been signed out.');
    },
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to reset password.')),
  });

  const removeMutation = useMutation({
    mutationFn: (reassignToId: string | undefined) =>
      apiClient.workspace.removeMember(selectedMember!.id, reassignToId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace', 'members'] });
      setShowRemove(false);
      setSelectedMember(null);
    },
    onError: (err) => Alert.alert('Error', getErrorMessage(err, 'Failed to remove member.')),
  });

  const allMembers = members ?? [];
  const activeMembers = allMembers.filter((m) => m.status === 'ACTIVE');
  const suspendedMembers = allMembers.filter((m) => m.status === 'SUSPENDED');
  const pendingInvitations = invitations ?? [];

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={22} color="#25D366" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-white font-semibold text-base">Team</Text>
            <Text className="text-white/40 text-xs mt-0.5">
              {allMembers.length} member{allMembers.length === 1 ? '' : 's'}
            </Text>
          </View>
          <TouchableOpacity
            className="bg-green rounded-full w-9 h-9 items-center justify-center"
            onPress={() => setShowInvite(true)}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {membersLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchAll} tintColor="#25D366" />}
        >
          {pendingInvitations.length > 0 && (
            <>
              <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
                Pending Invitations
              </Text>
              <View className="bg-surface-card rounded-2xl border border-white/5 mb-5 overflow-hidden">
                {pendingInvitations.map((inv) => (
                  <PendingInviteRow
                    key={inv.id}
                    invite={inv}
                    onCancel={() =>
                      Alert.alert('Cancel Invitation', `Cancel the invitation to ${inv.email}?`, [
                        { text: 'Keep', style: 'cancel' },
                        { text: 'Cancel Invite', style: 'destructive', onPress: () => cancelInviteMutation.mutate(inv.id) },
                      ])
                    }
                  />
                ))}
              </View>
            </>
          )}

          <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
            Active Members
          </Text>
          <View className="bg-surface-card rounded-2xl border border-white/5 mb-5 overflow-hidden">
            {activeMembers.length === 0 ? (
              <View className="px-4 py-6 items-center">
                <Text className="text-white/30 text-sm">No active members</Text>
              </View>
            ) : (
              activeMembers.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isMe={m.userId === currentUserId}
                  onPress={() => setSelectedMember(m)}
                />
              ))
            )}
          </View>

          {suspendedMembers.length > 0 && (
            <>
              <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
                Suspended
              </Text>
              <View className="bg-surface-card rounded-2xl border border-white/5 mb-5 overflow-hidden opacity-60">
                {suspendedMembers.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    isMe={m.userId === currentUserId}
                    onPress={() => setSelectedMember(m)}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <MemberActionSheet
        member={selectedMember}
        isMe={selectedMember?.userId === currentUserId}
        visible={!!selectedMember && !showEdit && !showResetPassword && !showRemove && !showActivity}
        onClose={() => setSelectedMember(null)}
        onEdit={() => setShowEdit(true)}
        onViewActivity={() => setShowActivity(true)}
        onSuspend={() =>
          Alert.alert('Suspend Member', `Suspend ${selectedMember?.user?.name ?? 'this member'}?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Suspend',
              style: 'destructive',
              onPress: () => {
                suspendMutation.mutate(selectedMember!.id);
                setSelectedMember(null);
              },
            },
          ])
        }
        onReactivate={() => {
          reactivateMutation.mutate(selectedMember!.id);
          setSelectedMember(null);
        }}
        onForceLogout={() =>
          Alert.alert('Force Logout', `Sign ${selectedMember?.user?.name ?? 'this member'} out of all sessions?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Force Logout',
              style: 'destructive',
              onPress: () => {
                forceLogoutMutation.mutate(selectedMember!.id);
                setSelectedMember(null);
              },
            },
          ])
        }
        onResetPassword={() => setShowResetPassword(true)}
        onRemove={() => setShowRemove(true)}
      />

      <InviteModal
        visible={showInvite}
        result={inviteResult}
        isPending={inviteMutation.isPending}
        onSubmit={(data) => inviteMutation.mutate(data)}
        onClose={() => {
          setShowInvite(false);
          setInviteResult(null);
        }}
      />

      <EditMemberModal
        member={selectedMember}
        visible={showEdit}
        isPending={editMutation.isPending}
        onSubmit={(data) => editMutation.mutate(data)}
        onClose={() => {
          setShowEdit(false);
          setSelectedMember(null);
        }}
      />

      <ResetPasswordModal
        visible={showResetPassword}
        isPending={resetPasswordMutation.isPending}
        onSubmit={(pw) => resetPasswordMutation.mutate(pw)}
        onClose={() => {
          setShowResetPassword(false);
          setSelectedMember(null);
        }}
      />

      <RemoveMemberModal
        member={selectedMember}
        members={allMembers}
        visible={showRemove}
        isPending={removeMutation.isPending}
        onSubmit={(reassignToId) => removeMutation.mutate(reassignToId)}
        onClose={() => {
          setShowRemove(false);
          setSelectedMember(null);
        }}
      />

      <ActivityModal
        member={selectedMember}
        visible={showActivity}
        onClose={() => {
          setShowActivity(false);
          setSelectedMember(null);
        }}
      />
    </SafeAreaView>
  );
}

function RoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <View className="bg-white/10 rounded-full px-2 py-0.5">
      <Text className="text-white/60 text-[10px] font-semibold">{ROLE_LABELS[role]}</Text>
    </View>
  );
}

function RolePicker({ value, onChange }: { value: WorkspaceRole; onChange: (r: WorkspaceRole) => void }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {WORKSPACE_ROLES.map((r) => (
        <TouchableOpacity
          key={r}
          onPress={() => onChange(r)}
          className={`px-3 py-2 rounded-xl border ${value === r ? 'bg-green border-green' : 'border-white/10'}`}
        >
          <Text className={`text-xs font-semibold ${value === r ? 'text-white' : 'text-white/50'}`}>
            {ROLE_LABELS[r]}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function MemberRow({ member, isMe, onPress }: { member: Member; isMe: boolean; onPress: () => void }) {
  const name = member.user?.name || member.user?.email || 'Unknown';
  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3.5 border-b border-white/5 last:border-0 gap-3"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View className="w-10 h-10 rounded-full bg-green/20 items-center justify-center">
        <Text className="text-green font-bold">{name.charAt(0).toUpperCase()}</Text>
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-white font-semibold text-sm" numberOfLines={1}>{name}</Text>
          {isMe && (
            <View className="bg-green/20 rounded-full px-1.5 py-0.5">
              <Text className="text-green text-[9px] font-bold">YOU</Text>
            </View>
          )}
          {member.status === 'SUSPENDED' && (
            <View className="bg-red-500/20 rounded-full px-1.5 py-0.5">
              <Text className="text-red-400 text-[9px] font-bold">SUSPENDED</Text>
            </View>
          )}
        </View>
        <Text className="text-white/40 text-xs mt-0.5" numberOfLines={1}>
          {member.user?.email}
          {member.department ? ` · ${member.department}` : ''}
        </Text>
        <Text className="text-white/25 text-[10px] mt-0.5">
          Last seen {timeAgo(member.user?.lastSeenAt)}
        </Text>
      </View>
      <RoleBadge role={member.role} />
      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.25)" />
    </TouchableOpacity>
  );
}

function PendingInviteRow({ invite, onCancel }: { invite: Invitation; onCancel: () => void }) {
  return (
    <View className="flex-row items-center px-4 py-3.5 border-b border-white/5 last:border-0 gap-3">
      <View className="w-10 h-10 rounded-full bg-white/10 items-center justify-center">
        <Ionicons name="mail-outline" size={16} color="rgba(255,255,255,0.4)" />
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-white font-semibold text-sm" numberOfLines={1}>
          {invite.name || invite.email}
        </Text>
        <Text className="text-white/40 text-xs mt-0.5" numberOfLines={1}>{invite.email}</Text>
        <Text className="text-white/25 text-[10px] mt-0.5">
          Expires {new Date(invite.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </Text>
      </View>
      <RoleBadge role={invite.role} />
      <TouchableOpacity onPress={onCancel} className="p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close-circle" size={20} color="rgba(239,68,68,0.6)" />
      </TouchableOpacity>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity className="flex-row items-center gap-3 px-4 py-3.5" onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={18} color={danger ? '#ef4444' : 'rgba(255,255,255,0.7)'} />
      <Text className={`text-sm font-medium ${danger ? 'text-red-400' : 'text-white'}`}>{label}</Text>
    </TouchableOpacity>
  );
}

function MemberActionSheet({
  member,
  isMe,
  visible,
  onClose,
  onEdit,
  onViewActivity,
  onSuspend,
  onReactivate,
  onForceLogout,
  onResetPassword,
  onRemove,
}: {
  member: Member | null;
  isMe: boolean;
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onViewActivity: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onForceLogout: () => void;
  onResetPassword: () => void;
  onRemove: () => void;
}) {
  if (!member) return null;
  const isOwner = member.role === 'OWNER';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View className="bg-surface rounded-t-3xl pb-2">
          <View className="flex-row items-center justify-between px-6 pt-6 pb-2">
            <View className="flex-1 min-w-0">
              <Text className="text-white font-bold text-base" numberOfLines={1}>
                {member.user?.name || member.user?.email}
              </Text>
              <Text className="text-white/40 text-xs mt-0.5" numberOfLines={1}>{member.user?.email}</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>

          <ActionRow icon="create-outline" label="Edit Profile" onPress={onEdit} />
          <ActionRow icon="stats-chart-outline" label="View Activity" onPress={onViewActivity} />

          {!isMe && !isOwner && member.status === 'ACTIVE' && (
            <ActionRow icon="pause-circle-outline" label="Suspend" onPress={onSuspend} />
          )}
          {!isMe && !isOwner && member.status === 'SUSPENDED' && (
            <ActionRow icon="play-circle-outline" label="Reactivate" onPress={onReactivate} />
          )}
          {!isMe && <ActionRow icon="log-out-outline" label="Force Logout" onPress={onForceLogout} />}
          {!isMe && <ActionRow icon="key-outline" label="Reset Password" onPress={onResetPassword} />}
          {!isMe && !isOwner && (
            <ActionRow icon="trash-outline" label="Remove from Workspace" onPress={onRemove} danger />
          )}
        </View>
      </View>
    </Modal>
  );
}

function InviteModal({
  visible,
  result,
  isPending,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  result: { email: string; link: string } | null;
  isPending: boolean;
  onSubmit: (data: { email: string; role: WorkspaceRole; name?: string }) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('AGENT');

  useEffect(() => {
    if (!visible) {
      setEmail('');
      setName('');
      setRole('AGENT');
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View className="bg-surface rounded-t-3xl p-6">
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-white text-lg font-bold">Invite Team Member</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>

          {result ? (
            <View>
              <Text className="text-white/70 text-sm mb-3">
                Invite sent to {result.email}. They have 72 hours to accept.
                {result.link ? ' You can also share this link directly:' : ''}
              </Text>
              {!!result.link && (
                <View className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 mb-5">
                  <Text selectable className="text-green text-xs">{result.link}</Text>
                </View>
              )}
              <TouchableOpacity className="bg-green rounded-2xl py-4 items-center" onPress={onClose}>
                <Text className="text-white font-bold text-base">Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text className="text-white/50 text-xs mb-1.5">Email</Text>
              <TextInput
                className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-4"
                placeholder="agent@example.com"
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text className="text-white/50 text-xs mb-1.5">Name (optional)</Text>
              <TextInput
                className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-4"
                placeholder="Jane Doe"
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={name}
                onChangeText={setName}
              />
              <Text className="text-white/50 text-xs mb-2">Role</Text>
              <View className="mb-5">
                <RolePicker value={role} onChange={setRole} />
              </View>
              <TouchableOpacity
                className="bg-green rounded-2xl py-4 items-center"
                disabled={!email || isPending}
                style={{ opacity: !email || isPending ? 0.5 : 1 }}
                onPress={() => onSubmit({ email: email.trim(), name: name.trim() || undefined, role })}
              >
                {isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-base">Send Invite</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function EditMemberModal({
  member,
  visible,
  isPending,
  onSubmit,
  onClose,
}: {
  member: Member | null;
  visible: boolean;
  isPending: boolean;
  onSubmit: (data: { name: string; email: string; phone: string; department: string; role: WorkspaceRole }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('AGENT');

  useEffect(() => {
    if (member && visible) {
      setName(member.user?.name ?? '');
      setEmail(member.user?.email ?? '');
      setPhone(member.user?.phone ?? '');
      setDepartment(member.department ?? '');
      setRole(member.role);
    }
  }, [member, visible]);

  if (!member) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View className="bg-surface rounded-t-3xl p-6">
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-white text-lg font-bold">Edit Member</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            <Text className="text-white/50 text-xs mb-1.5">Name</Text>
            <TextInput
              className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-4"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={name}
              onChangeText={setName}
            />
            <Text className="text-white/50 text-xs mb-1.5">Email</Text>
            <TextInput
              className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-4"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text className="text-white/50 text-xs mb-1.5">Phone</Text>
            <TextInput
              className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-4"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Text className="text-white/50 text-xs mb-1.5">Department</Text>
            <TextInput
              className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-4"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={department}
              onChangeText={setDepartment}
            />
            <Text className="text-white/50 text-xs mb-2">Role</Text>
            <RolePicker value={role} onChange={setRole} />
          </ScrollView>
          <TouchableOpacity
            className="bg-green rounded-2xl py-4 items-center mt-5"
            disabled={isPending}
            style={{ opacity: isPending ? 0.5 : 1 }}
            onPress={() => onSubmit({ name, email, phone, department, role })}
          >
            {isPending ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">Save Changes</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function ResetPasswordModal({
  visible,
  isPending,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  isPending: boolean;
  onSubmit: (newPassword: string) => void;
  onClose: () => void;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!visible) {
      setPw('');
      setConfirm('');
    }
  }, [visible]);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const canSubmit = pw.length >= 8 && pw === confirm && !isPending;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View className="bg-surface rounded-t-3xl p-6">
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-white text-lg font-bold">Reset Password</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>
          <Text className="text-white/50 text-xs mb-1.5">New Password</Text>
          <TextInput
            className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-1"
            placeholderTextColor="rgba(255,255,255,0.2)"
            value={pw}
            onChangeText={setPw}
            secureTextEntry
            autoCapitalize="none"
          />
          {tooShort && <Text className="text-red-400 text-xs mb-3">Must be at least 8 characters</Text>}
          {!tooShort && <View className="mb-3" />}
          <Text className="text-white/50 text-xs mb-1.5">Confirm Password</Text>
          <TextInput
            className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-1"
            placeholderTextColor="rgba(255,255,255,0.2)"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
          />
          {mismatch && <Text className="text-red-400 text-xs mb-3">Passwords do not match</Text>}
          {!mismatch && <View className="mb-3" />}
          <TouchableOpacity
            className="bg-green rounded-2xl py-4 items-center mt-2"
            disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.5 }}
            onPress={() => onSubmit(pw)}
          >
            {isPending ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">Reset Password</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function RemoveMemberModal({
  member,
  members,
  visible,
  isPending,
  onSubmit,
  onClose,
}: {
  member: Member | null;
  members: Member[];
  visible: boolean;
  isPending: boolean;
  onSubmit: (reassignToId?: string) => void;
  onClose: () => void;
}) {
  const [reassignToId, setReassignToId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!visible) setReassignToId(undefined);
  }, [visible]);

  if (!member) return null;
  const candidates = members.filter((m) => m.id !== member.id && m.status === 'ACTIVE');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View className="bg-surface rounded-t-3xl p-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-white text-lg font-bold">Remove Member</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>
          <Text className="text-white/50 text-sm mb-4">
            Remove {member.user?.name || member.user?.email} from the workspace? Their open conversations can be
            reassigned to another active member, or left unassigned.
          </Text>

          <ScrollView style={{ maxHeight: 220 }} className="mb-4">
            <TouchableOpacity
              className="flex-row items-center justify-between px-4 py-3 bg-surface-card rounded-xl mb-2"
              onPress={() => setReassignToId(undefined)}
            >
              <Text className="text-white text-sm">Leave unassigned</Text>
              {reassignToId === undefined && <Ionicons name="checkmark" size={18} color="#25D366" />}
            </TouchableOpacity>
            {candidates.map((m) => (
              <TouchableOpacity
                key={m.id}
                className="flex-row items-center justify-between px-4 py-3 bg-surface-card rounded-xl mb-2"
                onPress={() => setReassignToId(m.userId)}
              >
                <Text className="text-white text-sm" numberOfLines={1}>
                  {m.user?.name || m.user?.email}
                </Text>
                {reassignToId === m.userId && <Ionicons name="checkmark" size={18} color="#25D366" />}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            className="border border-red-500/30 rounded-2xl py-4 items-center"
            disabled={isPending}
            style={{ opacity: isPending ? 0.5 : 1 }}
            onPress={() => onSubmit(reassignToId)}
          >
            {isPending ? (
              <ActivityIndicator color="#ef4444" />
            ) : (
              <Text className="text-red-400 font-bold text-base">Remove from Workspace</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function StatRow({ label, value }: { label: string; value: number | string }) {
  return (
    <View className="flex-row items-center justify-between bg-surface-card rounded-xl px-4 py-3 mb-2">
      <Text className="text-white/60 text-sm">{label}</Text>
      <Text className="text-white font-bold text-sm">{typeof value === 'number' ? value.toLocaleString() : value}</Text>
    </View>
  );
}

function ActivityModal({
  member,
  visible,
  onClose,
}: {
  member: Member | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'member-activity', member?.id],
    queryFn: () => apiClient.workspace.getMemberActivity(member!.id).then((r) => unwrap<ActivityStats>(r.data)),
    enabled: visible && !!member,
  });

  if (!member) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View className="bg-surface rounded-t-3xl p-6">
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-white text-lg font-bold">Activity</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>
          {isLoading || !data ? (
            <ActivityIndicator color="#25D366" />
          ) : (
            <View>
              <StatRow label="Assigned Conversations" value={data.stats.assignedConversations} />
              <StatRow label="Resolved Conversations" value={data.stats.resolvedConversations} />
              <StatRow label="Messages Sent" value={data.stats.sentMessages} />
              <StatRow label="Notes Added" value={data.stats.notesAdded} />
              <StatRow label="Last Seen" value={timeAgo(data.member.user?.lastSeenAt)} />
              <StatRow label="Last Login" value={timeAgo(data.member.user?.lastLoginAt)} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
