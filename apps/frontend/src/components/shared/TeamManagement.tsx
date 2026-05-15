'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  UserPlus, X, Link as LinkIcon, MoreVertical, Edit2, LogOut,
  Trash2, ShieldOff, ShieldCheck, KeyRound, Activity,
  ChevronDown, Check, AlertTriangle, Clock, MessageSquare,
  CheckCircle2, FileText,
} from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkspaceMember {
  id: string;
  role: string;
  status: string;
  department: string | null;
  userId: string;
  joinedAt: string | null;
  user: {
    id: string; name: string; email: string;
    avatarUrl: string | null; phone: string | null;
    isActive: boolean; lastSeenAt: string | null; lastLoginAt: string | null;
  } | null;
}

interface WorkspaceInvitation {
  id: string; email: string; name: string | null; role: string;
  expiresAt: string; createdAt: string;
}

interface MemberActivity {
  member: WorkspaceMember;
  stats: {
    assignedConversations: number;
    resolvedConversations: number;
    sentMessages: number;
    notesAdded: number;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLE_OPTIONS = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'ANALYST', 'VIEWER'] as const;

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-orange-50 text-orange-700 border-orange-200',
  ADMIN: 'bg-purple-50 text-purple-700 border-purple-200',
  MANAGER: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  AGENT: 'bg-blue-50 text-blue-700 border-blue-200',
  ANALYST: 'bg-teal-50 text-teal-700 border-teal-200',
  VIEWER: 'bg-gray-100 text-gray-600 border-gray-200',
};

const INPUT = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-gray-50 focus:bg-white transition-colors';
const BTN_PRIMARY = 'px-5 py-2.5 bg-teal-600 text-white text-sm rounded-xl font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors';
const BTN_GHOST = 'px-4 py-2.5 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50 transition-colors';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
      {copied ? <Check className="w-3.5 h-3.5 text-teal-500" /> : <LinkIcon className="w-3.5 h-3.5" />}
    </button>
  );
}

function Avatar({ name, avatarUrl, size = 9 }: { name: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={`w-${size} h-${size} rounded-full object-cover flex-shrink-0`} />;
  }
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className={`w-${size} h-${size} rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 flex-shrink-0`}>
      {initials || '?'}
    </div>
  );
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const run = async () => { setLoading(true); try { await onConfirm(); } finally { setLoading(false); } };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex gap-3 mb-5">
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', danger ? 'bg-red-50' : 'bg-amber-50')}>
          <AlertTriangle size={18} className={danger ? 'text-red-500' : 'text-amber-500'} />
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
      </div>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className={BTN_GHOST}>Cancel</button>
        <button onClick={() => { void run(); }} disabled={loading}
          className={cn('px-5 py-2.5 text-sm rounded-xl font-semibold transition-colors disabled:opacity-50',
            danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white')}>
          {loading ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function EditMemberModal({ member, onSave, onClose }: {
  member: WorkspaceMember; onSave: () => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: member.user?.name ?? '',
    email: member.user?.email ?? '',
    phone: member.user?.phone ?? '',
    department: member.department ?? '',
    role: member.role,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await workspaceApi.editMember(member.id, form);
      toast.success('Member updated');
      onSave();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to update member');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Edit Member" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Full Name">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={INPUT} />
            </Field>
          </div>
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={INPUT} />
          </Field>
          <Field label="Phone">
            <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+1 555 000 0000" className={INPUT} />
          </Field>
          <Field label="Department">
            <input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Support" className={INPUT} />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={cn(INPUT, 'cursor-pointer')}>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={() => { void save(); }} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save Changes'}</button>
          <button onClick={onClose} className={BTN_GHOST}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ member, onClose }: { member: WorkspaceMember; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (pw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (pw !== confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      await workspaceApi.resetPassword(member.id, pw);
      toast.success('Password reset — user will be logged out');
      onClose();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to reset password');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Reset Password" onClose={onClose}>
      <p className="text-sm text-gray-500 mb-4">
        Set a new password for <strong>{member.user?.name ?? member.user?.email}</strong>. They will be immediately logged out.
      </p>
      <div className="space-y-3">
        <Field label="New Password">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Min. 8 characters" className={INPUT} />
        </Field>
        <Field label="Confirm Password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={INPUT} />
        </Field>
        <div className="flex gap-3 pt-1">
          <button onClick={() => { void save(); }} disabled={saving || !pw} className={BTN_PRIMARY}>{saving ? 'Resetting…' : 'Reset Password'}</button>
          <button onClick={onClose} className={BTN_GHOST}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function RemoveMemberModal({ member, allMembers, onConfirm, onClose }: {
  member: WorkspaceMember;
  allMembers: WorkspaceMember[];
  onConfirm: (reassignToId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reassignToId, setReassignToId] = useState('');
  const [loading, setLoading] = useState(false);
  const eligible = allMembers.filter((m) => m.id !== member.id && m.status === 'ACTIVE');

  const run = async () => {
    setLoading(true);
    try { await onConfirm(reassignToId || undefined); } finally { setLoading(false); }
  };

  return (
    <Modal title="Remove Member" onClose={onClose}>
      <p className="text-sm text-gray-600 mb-4">
        Remove <strong>{member.user?.name ?? member.user?.email}</strong> from this workspace. Their open conversations will be unassigned unless you reassign them.
      </p>
      <div className="space-y-3">
        <Field label="Reassign open conversations to (optional)">
          <select value={reassignToId} onChange={(e) => setReassignToId(e.target.value)} className={cn(INPUT, 'cursor-pointer')}>
            <option value="">— Leave unassigned —</option>
            {eligible.map((m) => (
              <option key={m.id} value={m.userId}>{m.user?.name ?? m.user?.email} ({m.role})</option>
            ))}
          </select>
        </Field>
        <div className="flex gap-3 pt-1">
          <button onClick={() => { void run(); }} disabled={loading}
            className="px-5 py-2.5 bg-red-600 text-white text-sm rounded-xl font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
            {loading ? 'Removing…' : 'Remove Member'}
          </button>
          <button onClick={onClose} className={BTN_GHOST}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function ActivityPanel({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const [data, setData] = useState<MemberActivity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    workspaceApi.getMemberActivity(memberId)
      .then((res) => setData(res.data as MemberActivity))
      .catch(() => toast.error('Failed to load activity'))
      .finally(() => setLoading(false));
  }, [memberId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:w-96 h-full sm:h-auto sm:max-h-[85vh] overflow-y-auto sm:rounded-l-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Member Activity</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
        ) : data ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={data.member.user?.name ?? '?'} avatarUrl={data.member.user?.avatarUrl} size={12} />
              <div>
                <p className="font-semibold text-gray-900">{data.member.user?.name ?? '—'}</p>
                <p className="text-sm text-gray-500">{data.member.user?.email}</p>
                {data.member.department && <p className="text-xs text-gray-400">{data.member.department}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Last Seen', value: timeAgo(data.member.user?.lastSeenAt ?? null), icon: Clock },
                { label: 'Last Login', value: timeAgo(data.member.user?.lastLoginAt ?? null), icon: Activity },
                { label: 'Assigned Convs', value: String(data.stats.assignedConversations), icon: MessageSquare },
                { label: 'Resolved', value: String(data.stats.resolvedConversations), icon: CheckCircle2 },
                { label: 'Messages Sent', value: String(data.stats.sentMessages), icon: MessageSquare },
                { label: 'Notes Added', value: String(data.stats.notesAdded), icon: FileText },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-gray-50 rounded-xl p-3 flex items-start gap-2">
                  <Icon size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-sm font-semibold text-gray-900">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Role</span>
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium border', ROLE_COLORS[data.member.role] ?? 'bg-gray-100 text-gray-600')}>
                  {data.member.role.charAt(0) + data.member.role.slice(1).toLowerCase()}
                </span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Status</span>
                <span className={cn('text-xs font-medium', data.member.status === 'ACTIVE' ? 'text-green-600' : 'text-red-500')}>
                  {data.member.status}
                </span>
              </div>
              {data.member.joinedAt && (
                <div className="flex justify-between text-gray-600">
                  <span>Joined</span>
                  <span className="text-gray-500">{new Date(data.member.joinedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Action Menu ──────────────────────────────────────────────────────────────

function MemberActionMenu({ member, isMe, onEdit, onSuspend, onReactivate, onForceLogout, onResetPassword, onViewActivity, onRemove }: {
  member: WorkspaceMember;
  isMe: boolean;
  onEdit: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onForceLogout: () => void;
  onResetPassword: () => void;
  onViewActivity: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  type MenuItem = { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean };
  const items: MenuItem[] = [
    { label: 'Edit Profile', icon: <Edit2 size={13} />, onClick: onEdit },
    { label: 'View Activity', icon: <Activity size={13} />, onClick: onViewActivity },
    { label: member.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend', icon: member.status === 'SUSPENDED' ? <ShieldCheck size={13} /> : <ShieldOff size={13} />, onClick: member.status === 'SUSPENDED' ? onReactivate : onSuspend, hidden: isMe || member.role === 'OWNER' },
    { label: 'Force Logout', icon: <LogOut size={13} />, onClick: onForceLogout, hidden: isMe },
    { label: 'Reset Password', icon: <KeyRound size={13} />, onClick: onResetPassword, hidden: isMe },
    { label: 'Remove from Workspace', icon: <Trash2 size={13} />, onClick: onRemove, danger: true, hidden: isMe || member.role === 'OWNER' },
  ].filter((item) => !item.hidden);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button ref={btnRef} onClick={handleToggle}
        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
        <MoreVertical size={14} />
      </button>
      {open && (
        <div
          style={{ top: menuPos.top, right: menuPos.right }}
          className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-48 min-w-max"
        >
          {items.map((item) => (
            <button key={item.label} onClick={() => { setOpen(false); item.onClick(); }}
              className={cn('w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors text-left',
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50')}>
              {item.icon}{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Invite Form ──────────────────────────────────────────────────────────────

function InviteForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ email: '', role: 'AGENT', name: '' });
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const send = async () => {
    if (!form.email) { toast.error('Email is required'); return; }
    setInviting(true);
    try {
      const res = await workspaceApi.invite(form.email, form.role, form.name || undefined);
      const { link: inviteLink } = res.data as { link: string };
      setLink(inviteLink);
      void navigator.clipboard.writeText(inviteLink).catch(() => {});
      toast.success('Invite link created and copied!');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to create invitation');
    } finally { setInviting(false); }
  };

  return (
    <div className="bg-white border border-teal-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Invite Team Member</h3>
        <button onClick={onDone} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>

      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Share this link — it expires in 72 hours.</p>
          <div className="flex items-center gap-2 bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
            <code className="text-xs text-teal-800 flex-1 break-all">{link}</code>
            <CopyButton value={link} />
          </div>
          <button onClick={() => { setLink(null); setForm({ email: '', role: 'AGENT', name: '' }); onDone(); }}
            className="text-sm text-teal-600 hover:underline">Done</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Email *">
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="agent@company.com" className={INPUT} />
              </Field>
            </div>
            <Field label="Name (optional)">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith" className={INPUT} />
            </Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={cn(INPUT, 'cursor-pointer')}>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => { void send(); }} disabled={inviting || !form.email} className={BTN_PRIMARY}>
              {inviting ? 'Generating…' : 'Generate Invite Link'}
            </button>
            <button onClick={onDone} className={BTN_GHOST}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TeamManagement() {
  const { user: authUser } = useAuthStore();

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state
  const [showInvite, setShowInvite] = useState(false);
  const [editMember, setEditMember] = useState<WorkspaceMember | null>(null);
  const [resetPwMember, setResetPwMember] = useState<WorkspaceMember | null>(null);
  const [removeMember, setRemoveMember] = useState<WorkspaceMember | null>(null);
  const [activityMemberId, setActivityMemberId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string; message: string; label: string; danger?: boolean; run: () => Promise<void>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, iRes] = await Promise.all([workspaceApi.listMembers(), workspaceApi.listInvitations()]);
      setMembers(mRes.data as WorkspaceMember[]);
      setInvitations(iRes.data as WorkspaceInvitation[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Listen for realtime member-updated events from SocketProvider
  useEffect(() => {
    const handler = () => { void load(); };
    window.addEventListener('workspace:member-updated', handler);
    return () => window.removeEventListener('workspace:member-updated', handler);
  }, [load]);

  const handleSuspend = (member: WorkspaceMember) => {
    setConfirmAction({
      title: 'Suspend Member',
      message: `Suspend ${member.user?.name ?? member.user?.email}? They will be immediately logged out and unable to access the workspace.`,
      label: 'Suspend',
      danger: true,
      run: async () => {
        await workspaceApi.suspendMember(member.id);
        toast.success('Member suspended');
        void load();
        setConfirmAction(null);
      },
    });
  };

  const handleReactivate = (member: WorkspaceMember) => {
    setConfirmAction({
      title: 'Reactivate Member',
      message: `Reactivate ${member.user?.name ?? member.user?.email}? They will regain access to the workspace.`,
      label: 'Reactivate',
      run: async () => {
        await workspaceApi.reactivateMember(member.id);
        toast.success('Member reactivated');
        void load();
        setConfirmAction(null);
      },
    });
  };

  const handleForceLogout = (member: WorkspaceMember) => {
    setConfirmAction({
      title: 'Force Logout',
      message: `Log out ${member.user?.name ?? member.user?.email} from all devices? Their sessions will be invalidated.`,
      label: 'Force Logout',
      danger: true,
      run: async () => {
        await workspaceApi.forceLogout(member.id);
        toast.success('User logged out');
        void load();
        setConfirmAction(null);
      },
    });
  };

  const handleRemove = async (reassignToId?: string) => {
    if (!removeMember) return;
    try {
      await workspaceApi.removeMember(removeMember.id, reassignToId);
      toast.success('Member removed');
      setRemoveMember(null);
      void load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to remove member');
    }
  };

  const cancelInvitation = async (id: string) => {
    try {
      await workspaceApi.cancelInvitation(id);
      toast.success('Invitation cancelled');
      void load();
    } catch { toast.error('Failed to cancel invitation'); }
  };

  const activeMembers = members.filter((m) => m.status !== 'SUSPENDED');
  const suspendedMembers = members.filter((m) => m.status === 'SUSPENDED');

  const MemberRow = ({ member }: { member: WorkspaceMember }) => {
    const u = member.user;
    const isMe = u?.id === authUser?.id;
    const suspended = member.status === 'SUSPENDED';

    return (
      <div className={cn('flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors group', suspended && 'opacity-60')}>
        <Avatar name={u?.name ?? '?'} avatarUrl={u?.avatarUrl} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium text-gray-900 truncate">{u?.name ?? '—'}</p>
            {isMe && <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full border border-teal-200">You</span>}
            {suspended && <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full border border-red-200">Suspended</span>}
          </div>
          <p className="text-xs text-gray-500 truncate">{u?.email ?? '—'}{member.department ? ` · ${member.department}` : ''}</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400">
          <Clock size={11} />{timeAgo(u?.lastSeenAt ?? null)}
        </div>
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border hidden sm:inline-flex', ROLE_COLORS[member.role] ?? 'bg-gray-100 text-gray-600')}>
          {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
          <ChevronDown size={9} className="ml-0.5 opacity-50 my-auto" />
        </span>
        <MemberActionMenu
          member={member}
          isMe={isMe}
          onEdit={() => setEditMember(member)}
          onSuspend={() => handleSuspend(member)}
          onReactivate={() => handleReactivate(member)}
          onForceLogout={() => handleForceLogout(member)}
          onResetPassword={() => setResetPwMember(member)}
          onViewActivity={() => setActivityMemberId(member.id)}
          onRemove={() => setRemoveMember(member)}
        />
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Team Members</h2>
          <p className="text-sm text-gray-500">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors">
          <UserPlus size={14} />Invite Member
        </button>
      </div>

      {/* Invite form */}
      {showInvite && <InviteForm onDone={() => { setShowInvite(false); void load(); }} />}

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pending Invitations ({invitations.length})</p>
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            {invitations.map((inv, i) => (
              <div key={inv.id} className={cn('flex items-center gap-3 px-5 py-3.5', i > 0 && 'border-t border-gray-100')}>
                <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-sm font-bold text-amber-500 flex-shrink-0 border border-amber-200">
                  {inv.email.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{inv.name ?? inv.email}</p>
                  <p className="text-xs text-gray-400">{inv.name ? inv.email + ' · ' : ''}Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border hidden sm:inline-flex', ROLE_COLORS[inv.role] ?? 'bg-gray-100 text-gray-600 border-gray-200')}>
                  {inv.role.charAt(0) + inv.role.slice(1).toLowerCase()}
                </span>
                <span className="text-xs bg-amber-50 text-amber-500 px-2 py-0.5 rounded-full border border-amber-200 font-medium">Pending</span>
                <button onClick={() => { void cancelInvitation(inv.id); }}
                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0" title="Cancel">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active members */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Active Members ({activeMembers.length})</p>
        {loading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
            {activeMembers.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No active members</p>}
            {activeMembers.map((m) => <MemberRow key={m.id} member={m} />)}
          </div>
        )}
      </div>

      {/* Suspended members */}
      {suspendedMembers.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Suspended ({suspendedMembers.length})</p>
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
            {suspendedMembers.map((m) => <MemberRow key={m.id} member={m} />)}
          </div>
        </div>
      )}

      {/* Modals */}
      {editMember && (
        <EditMemberModal member={editMember} onSave={() => { setEditMember(null); void load(); }} onClose={() => setEditMember(null)} />
      )}
      {resetPwMember && (
        <ResetPasswordModal member={resetPwMember} onClose={() => setResetPwMember(null)} />
      )}
      {removeMember && (
        <RemoveMemberModal member={removeMember} allMembers={members} onConfirm={handleRemove} onClose={() => setRemoveMember(null)} />
      )}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          danger={confirmAction.danger}
          onConfirm={confirmAction.run}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {activityMemberId && (
        <ActivityPanel memberId={activityMemberId} onClose={() => setActivityMemberId(null)} />
      )}
    </div>
  );
}
