'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff,
  Search, X, Plus, Link2, CalendarClock, MoreVertical,
  Copy, Check, Clock, RefreshCw,
  MessageSquare,
  Edit3, Trash2, AlertCircle, ArrowUpRight, ArrowDownLeft,
  TrendingUp, Activity, Archive, UserCheck, BarChart2,
  ChevronRight, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { callsApi, contactsApi, conversationsApi, usersApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useInboxStore } from '@/store/inbox.store';
import { useCallsStore } from '@/store/calls.store';
import { cn } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/modern-ui/table';

// ─── Types ────────────────────────────────────────────────────────────────────

type CallStatus =
  | 'SCHEDULED' | 'INITIATED' | 'RINGING' | 'INCOMING'
  | 'ONGOING' | 'MISSED' | 'DECLINED' | 'CANCELED'
  | 'UNANSWERED' | 'BUSY' | 'FAILED' | 'ENDED'
  // legacy values kept for old records
  | 'ANSWERED' | 'COMPLETED' | 'CANCELLED' | 'TRANSFERRED';
type CallDirection = 'INBOUND' | 'OUTBOUND';
type NavSection = 'all' | 'missed' | 'incoming' | 'outgoing' | 'scheduled' | 'archived';

interface CallContact { id: string; name: string | null; phone: string; avatarUrl: string | null; }
interface CallUser { id: string; name: string; avatarUrl: string | null; }
interface CallNote { id: string; content: string; createdAt: string; user: CallUser; }
interface CallLog {
  id: string; direction: CallDirection; status: CallStatus;
  duration: number | null; phone: string | null; notes: string | null;
  isArchived: boolean; endReason: string | null; recordingUrl: string | null;
  scheduledAt: string | null; startedAt: string | null; answeredAt: string | null; endedAt: string | null;
  createdAt: string; contact: CallContact | null; user: CallUser | null;
  callNotes: CallNote[];
}
interface Contact { id: string; name: string | null; phone: string; }
interface Agent { id: string; name: string; avatarUrl: string | null; }
interface Stats { total: number; todayTotal: number; missed: number; scheduled: number; active: number; inbound: number; outbound: number; }
interface Analytics { avgDuration: number; totalDuration: number; missedRate: number; completionRate: number; avgResponseTime: number; total: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `0:${String(seconds).padStart(2, '0')}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string | null, phone: string): string {
  if (name) return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return phone.slice(-2);
}

const AVATAR_COLORS = ['bg-orange-500', 'bg-violet-600', 'bg-teal-600', 'bg-blue-600', 'bg-pink-600', 'bg-amber-500', 'bg-emerald-600', 'bg-rose-500'];
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function downloadCallLog(call: CallLog) {
  const data = {
    id: call.id,
    direction: call.direction,
    status: call.status,
    contact: call.contact?.name ?? call.phone ?? 'Unknown',
    phone: call.contact?.phone ?? call.phone,
    agent: call.user?.name ?? 'Unassigned',
    duration: call.duration ? formatDuration(call.duration) : null,
    notes: call.notes,
    internalNotes: call.callNotes.map(n => ({ author: n.user.name, content: n.content, at: n.createdAt })),
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    endReason: call.endReason,
    recordingUrl: call.recordingUrl,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `call-${call.id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Status config ────────────────────────────────────────────────────────────

type DisplayStatus = CallStatus;

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string; text: string }> = {
  // Current states
  ENDED:       { label: 'Ended',       dot: 'bg-emerald-500', badge: 'bg-emerald-50 border-emerald-200',  text: 'text-emerald-700' },
  ONGOING:     { label: 'Ongoing',     dot: 'bg-teal-500',    badge: 'bg-teal-50 border-teal-200',        text: 'text-teal-700' },
  INCOMING:    { label: 'Incoming',    dot: 'bg-emerald-400', badge: 'bg-emerald-50 border-emerald-200',  text: 'text-emerald-700' },
  MISSED:      { label: 'Missed',      dot: 'bg-red-500',     badge: 'bg-red-50 border-red-200',          text: 'text-red-700' },
  UNANSWERED:  { label: 'Unanswered',  dot: 'bg-orange-500',  badge: 'bg-orange-50 border-orange-200',    text: 'text-orange-700' },
  DECLINED:    { label: 'Declined',    dot: 'bg-gray-500',    badge: 'bg-gray-50 border-gray-200',        text: 'text-gray-600' },
  CANCELED:    { label: 'Canceled',    dot: 'bg-gray-400',    badge: 'bg-gray-50 border-gray-200',        text: 'text-gray-500' },
  BUSY:        { label: 'Busy',        dot: 'bg-yellow-500',  badge: 'bg-yellow-50 border-yellow-200',    text: 'text-yellow-700' },
  RINGING:     { label: 'Ringing',     dot: 'bg-amber-500',   badge: 'bg-amber-50 border-amber-200',      text: 'text-amber-700' },
  SCHEDULED:   { label: 'Scheduled',   dot: 'bg-blue-500',    badge: 'bg-blue-50 border-blue-200',        text: 'text-blue-700' },
  INITIATED:   { label: 'Calling…',    dot: 'bg-sky-500',     badge: 'bg-sky-50 border-sky-200',          text: 'text-sky-700' },
  FAILED:      { label: 'Failed',      dot: 'bg-red-600',     badge: 'bg-red-50 border-red-200',          text: 'text-red-700' },
  // Legacy values (old records)
  ANSWERED:    { label: 'Answered',    dot: 'bg-teal-500',    badge: 'bg-teal-50 border-teal-200',        text: 'text-teal-700' },
  COMPLETED:   { label: 'Completed',   dot: 'bg-emerald-500', badge: 'bg-emerald-50 border-emerald-200',  text: 'text-emerald-700' },
  CANCELLED:   { label: 'Cancelled',   dot: 'bg-gray-400',    badge: 'bg-gray-50 border-gray-200',        text: 'text-gray-500' },
  TRANSFERRED: { label: 'Transferred', dot: 'bg-purple-500',  badge: 'bg-purple-50 border-purple-200',    text: 'text-purple-700' },
};

const MISSED_STATUSES = new Set(['MISSED', 'UNANSWERED']);
const ACTIVE_STATUSES = new Set(['INITIATED', 'RINGING', 'INCOMING', 'ONGOING', 'ANSWERED']);

function resolveDisplayStatus(call: CallLog): DisplayStatus {
  return call.status;
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.CANCELLED;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full border', cfg.badge, cfg.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot, status === 'RINGING' && 'animate-pulse')} />
      {cfg.label}
    </span>
  );
}

function DirectionIcon({ direction, size = 14 }: { direction: CallDirection; size?: number }) {
  if (direction === 'INBOUND') return <ArrowDownLeft size={size} className="text-emerald-500 flex-shrink-0" />;
  return <ArrowUpRight size={size} className="text-blue-500 flex-shrink-0" />;
}

function Avatar({ call, size = 'md' }: { call: CallLog; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' };
  const name = call.contact?.name ?? null;
  const phone = call.contact?.phone ?? call.phone ?? '';
  const id = call.contact?.id ?? call.id;
  return (
    <div className={cn('rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 relative', dims[size], avatarColor(id))}>
      {getInitials(name, phone)}
      <span className={cn(
        'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white',
        ACTIVE_STATUSES.has(call.status) ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300',
      )} />
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ScheduleModal({ onClose, contacts, onScheduled }: { onClose: () => void; contacts: Contact[]; onScheduled: () => void }) {
  const [form, setForm] = useState({ contactId: '', phone: '', date: '', time: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if ((!form.contactId && !form.phone) || !form.date || !form.time) {
      toast.error('Select a contact (or enter phone), date and time'); return;
    }
    setSaving(true);
    try {
      const scheduledAt = new Date(`${form.date}T${form.time}`).toISOString();
      await callsApi.create({ ...(form.contactId ? { contactId: form.contactId } : { phone: form.phone }), direction: 'OUTBOUND', status: 'SCHEDULED', scheduledAt, notes: form.notes || undefined });
      toast.success('Call scheduled'); onScheduled(); onClose();
    } catch { toast.error('Failed to schedule call'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title="Schedule a call" onClose={onClose}>
      <div className="px-6 py-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">Contact</label>
          <select value={form.contactId} onChange={e => setForm(p => ({ ...p, contactId: e.target.value, phone: '' }))}
            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
            <option value="">Select a contact…</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone} — {c.phone}</option>)}
          </select>
        </div>
        {!form.contactId && (
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">Or enter phone number</label>
            <input type="text" placeholder="+1 555 000 0000" value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">Date</label>
            <input type="date" value={form.date} min={new Date().toISOString().split('T')[0]}
              onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">Time</label>
            <input type="time" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
              className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">Notes (optional)</label>
          <textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            placeholder="Purpose of the call…"
            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 resize-none" />
        </div>
      </div>
      <div className="px-6 pb-5 flex gap-2.5">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
        <button onClick={() => { void handleSave(); }} disabled={saving}
          className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-colors">
          {saving ? 'Scheduling…' : 'Schedule Call'}
        </button>
      </div>
    </ModalShell>
  );
}

function CallLinkModal({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(true);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await callsApi.generateLink();
        const d = res.data as { url: string; expiresAt: string };
        setLink(d.url);
        setExpiresAt(d.expiresAt);
      } catch {
        toast.error('Failed to generate link');
        onClose();
      } finally {
        setGenerating(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => { void navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <ModalShell title="Create call link" onClose={onClose}>
      <div className="px-6 py-4 space-y-3">
        <p className="text-sm text-gray-600">Share this link to start a call with a customer or teammate.</p>
        {generating ? (
          <div className="flex items-center justify-center py-6">
            <span className="w-5 h-5 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3">
              <Link2 size={14} className="text-teal-600 flex-shrink-0" />
              <span className="flex-1 text-xs text-gray-700 font-mono truncate">{link}</span>
              <button onClick={copy} className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-800 px-2 py-1 bg-teal-50 rounded-lg transition-colors">
                {copied ? <><Check size={12} />Copied!</> : <><Copy size={12} />Copy</>}
              </button>
            </div>
            <div className="flex items-start gap-2 text-xs text-gray-500 bg-blue-50 px-3 py-2.5 rounded-xl">
              <AlertCircle size={12} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <span>
                Expires {expiresAt ? new Date(expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'in 24 hours'}.
                WebRTC/VoIP integration required for live calling.
              </span>
            </div>
          </>
        )}
      </div>
      <div className="px-6 pb-5">
        <button onClick={onClose} className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Close</button>
      </div>
    </ModalShell>
  );
}

function TransferModal({ call, agents, onClose, onTransferred }: { call: CallLog; agents: Agent[]; onClose: () => void; onTransferred: () => void }) {
  const [toUserId, setToUserId] = useState('');
  const [reason, setReason] = useState('');
  const [transferType, setTransferType] = useState<'BLIND' | 'WARM'>('BLIND');
  const [transferring, setTransferring] = useState(false);

  const handleTransfer = async () => {
    if (!toUserId) { toast.error('Select an agent'); return; }
    setTransferring(true);
    try {
      await callsApi.transfer(call.id, toUserId, reason || undefined, transferType);
      toast.success('Call transferred');
      onTransferred();
      onClose();
    } catch { toast.error('Transfer failed'); }
    finally { setTransferring(false); }
  };

  return (
    <ModalShell title="Transfer call" onClose={onClose}>
      <div className="px-6 py-4 space-y-3">
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm text-gray-700">
          <Phone size={13} className="text-gray-400" />
          <span className="font-medium">{call.contact?.name ?? call.phone ?? 'Unknown'}</span>
          <ChevronRight size={13} className="text-gray-300 mx-1" />
          <UserCheck size={13} className="text-teal-500" />
          <span className="text-gray-500">New agent</span>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">Transfer to</label>
          <select value={toUserId} onChange={e => setToUserId(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
            <option value="">Select agent…</option>
            {agents.filter(a => a.id !== call.user?.id).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">Transfer type</label>
          <div className="flex gap-2">
            {(['BLIND', 'WARM'] as const).map(t => (
              <button key={t} onClick={() => setTransferType(t)}
                className={cn('flex-1 py-2 rounded-xl text-xs font-bold border transition-colors',
                  transferType === t ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
                {t === 'BLIND' ? 'Blind (immediate)' : 'Warm (consult first)'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">Reason (optional)</label>
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Escalation, language preference…"
            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
        </div>
      </div>
      <div className="px-6 pb-5 flex gap-2.5">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
        <button onClick={() => { void handleTransfer(); }} disabled={transferring || !toUserId}
          className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1.5">
          <UserCheck size={14} />{transferring ? 'Transferring…' : 'Transfer'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function CallContextMenu({
  call, agents, onClose, onRefresh, onDial, onTransfer, onMessage,
}: {
  call: CallLog; agents: Agent[]; onClose: () => void; onRefresh: () => void;
  onDial: (phone: string) => void; onTransfer: (call: CallLog) => void; onMessage: (call: CallLog) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const phone = call.contact?.phone ?? call.phone ?? '';

  const handleArchive = async () => {
    onClose();
    try {
      await callsApi.archive(call.id);
      toast.success(call.isArchived ? 'Unarchived' : 'Archived');
      onRefresh();
    } catch { toast.error('Failed to archive'); }
  };

  const handleDelete = async () => {
    onClose();
    if (!confirm('Delete this call log permanently?')) return;
    try { await callsApi.delete(call.id); toast.success('Deleted'); onRefresh(); }
    catch { toast.error('Failed to delete'); }
  };

  const items: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[] = [
    { icon: <Phone size={13} />, label: 'Call back', onClick: () => { onClose(); onDial(phone); } },
    { icon: <MessageSquare size={13} />, label: 'Open in inbox', onClick: () => { onClose(); onMessage(call); } },
    { icon: <UserCheck size={13} />, label: 'Transfer call', onClick: () => { onClose(); onTransfer(call); }, disabled: !['RINGING', 'ANSWERED', 'INITIATED'].includes(call.status) },
    { icon: <Download size={13} />, label: 'Download log', onClick: () => { onClose(); downloadCallLog(call); } },
  ];

  return (
    <div ref={ref}
      className="absolute right-0 top-8 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-44 text-sm">
      {items.map((item, i) => (
        <button key={i} onClick={item.onClick} disabled={item.disabled}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
            item.danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50',
          )}>
          {item.icon}{item.label}
        </button>
      ))}
    </div>
  );
}


// ─── Call Detail Panel ────────────────────────────────────────────────────────

function CallDetail({
  call, agents, onClose, onRefresh, onDial, onTransfer, onMessage,
}: {
  call: CallLog; agents: Agent[]; onClose: () => void; onRefresh: () => void;
  onDial: (phone: string) => void; onTransfer: (call: CallLog) => void; onMessage: (call: CallLog) => void;
}) {
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const displayName = call.contact?.name ?? call.phone ?? 'Unknown';
  const displayPhone = call.contact?.phone ?? call.phone ?? '—';

  const handleAddNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try { await callsApi.addNote(call.id, note.trim()); setNote(''); onRefresh(); }
    catch { toast.error('Failed to save note'); }
    finally { setSavingNote(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this call log?')) return;
    try { await callsApi.delete(call.id); toast.success('Call deleted'); onClose(); onRefresh(); }
    catch { toast.error('Failed to delete'); }
  };

  const handleArchive = async () => {
    try {
      await callsApi.archive(call.id);
      toast.success(call.isArchived ? 'Unarchived' : 'Archived');
      onRefresh();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="w-80 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Call Details</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"><X size={15} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <Avatar call={call} size="lg" />
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 truncate">{displayName}</h3>
              <p className="text-xs text-gray-500 truncate">{displayPhone}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onDial(displayPhone)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors">
              <Phone size={13} />Call back
            </button>
            {call.contact?.id && (
              <button onClick={() => onMessage(call)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-xs font-semibold transition-colors">
                <MessageSquare size={13} />Message
              </button>
            )}
          </div>
          {ACTIVE_STATUSES.has(call.status) ? (
            <button onClick={() => onTransfer(call)}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 border border-teal-200 text-teal-600 hover:bg-teal-50 rounded-xl text-xs font-semibold transition-colors">
              <UserCheck size={13} />Transfer Call
            </button>
          ) : null}
        </div>

        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Call Info</p>
          <div className="grid grid-cols-2 gap-y-2.5 text-xs">
            <span className="text-gray-500">Status</span>
            <span className="flex justify-end"><StatusBadge status={resolveDisplayStatus(call)} /></span>
            <span className="text-gray-500">Direction</span>
            <span className="flex items-center justify-end gap-1 font-medium text-gray-700">
              <DirectionIcon direction={call.direction} size={12} />
              {call.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}
            </span>
            <span className="text-gray-500">Duration</span>
            <span className="text-right font-mono font-medium text-gray-700">{call.duration ? formatDuration(call.duration) : '—'}</span>
            <span className="text-gray-500">Agent</span>
            <span className="text-right text-gray-700 font-medium truncate">{call.user?.name ?? 'Unassigned'}</span>
            <span className="text-gray-500">Time</span>
            <span className="text-right text-gray-700">{new Date(call.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            {call.answeredAt && (
              <>
                <span className="text-gray-500">Answered</span>
                <span className="text-right text-gray-700">{new Date(call.answeredAt).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
              </>
            )}
            {call.scheduledAt && (
              <>
                <span className="text-gray-500">Scheduled</span>
                <span className="text-right text-blue-600 font-medium">{new Date(call.scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </>
            )}
            {call.endReason && (
              <>
                <span className="text-gray-500">End reason</span>
                <span className="text-right text-gray-600">{call.endReason}</span>
              </>
            )}
          </div>
        </div>

        {call.recordingUrl && (
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Recording</p>
            <audio controls src={call.recordingUrl} className="w-full h-8" />
          </div>
        )}

        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">Internal Notes</p>
          {call.callNotes.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No notes yet.</p>
          ) : (
            <div className="space-y-2.5">
              {call.callNotes.map(n => (
                <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-gray-800 leading-relaxed">{n.content}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[10px] font-medium text-amber-700">{n.user.name}</span>
                    <span className="text-[10px] text-amber-600/60">· {timeAgo(n.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-2">
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Add internal note…" rows={2}
              className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 resize-none" />
            <button onClick={() => { void handleAddNote(); }} disabled={savingNote || !note.trim()}
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5">
              <Edit3 size={11} />{savingNote ? 'Saving…' : 'Add Note'}
            </button>
          </div>
        </div>

        {call.notes && (
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Call Notes</p>
            <p className="text-xs text-gray-700 leading-relaxed">{call.notes}</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
        <button onClick={() => { downloadCallLog(call); }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 border border-gray-100 rounded-xl transition-colors font-medium flex-1 justify-center">
          <Download size={12} />Export
        </button>
      </div>
    </div>
  );
}

// ─── Analytics Banner ─────────────────────────────────────────────────────────

function AnalyticsBanner({ analytics }: { analytics: Analytics }) {
  const items = [
    { label: 'Total Calls', value: analytics.total, icon: <Phone size={14} className="text-gray-500" />, color: 'text-gray-700' },
    { label: 'Total Duration', value: formatDuration(analytics.totalDuration), icon: <Clock size={14} className="text-indigo-500" />, color: 'text-indigo-700' },
    { label: 'Avg Duration', value: formatDuration(analytics.avgDuration), icon: <Clock size={14} className="text-teal-500" />, color: 'text-teal-700' },
    { label: 'Missed Rate', value: `${analytics.missedRate}%`, icon: <PhoneMissed size={14} className="text-red-500" />, color: analytics.missedRate > 20 ? 'text-red-600' : 'text-gray-700' },
    { label: 'Completion Rate', value: `${analytics.completionRate}%`, icon: <TrendingUp size={14} className="text-emerald-500" />, color: 'text-emerald-700' },
    { label: 'Avg Response', value: analytics.avgResponseTime > 0 ? formatDuration(analytics.avgResponseTime) : '—', icon: <Activity size={14} className="text-blue-500" />, color: 'text-blue-700' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 mb-4 px-1">
      {items.map(item => (
        <div key={item.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
          {item.icon}
          <div>
            <p className={cn('text-base font-bold leading-none', item.color)}>{item.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-50 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-gray-200 rounded w-36" />
        <div className="h-2.5 bg-gray-100 rounded w-24" />
      </div>
      <div className="w-12 h-3 bg-gray-200 rounded" />
      <div className="w-24 h-5 bg-gray-200 rounded-full" />
      <div className="w-16 h-3 bg-gray-100 rounded" />
    </div>
  );
}

// ─── Call Row ─────────────────────────────────────────────────────────────────

function CallRow({
  call, selected, agents, onClick, onDial, onTransfer, onMessage, onRefresh,
}: {
  call: CallLog; selected: boolean; agents: Agent[];
  onClick: () => void; onDial: (phone: string) => void;
  onTransfer: (call: CallLog) => void; onMessage: (call: CallLog) => void; onRefresh: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = call.contact?.name ?? call.phone ?? 'Unknown';
  const phone = call.contact?.phone ?? call.phone ?? '—';

  return (
    <TableRow
      data-selected={selected}
      onClick={onClick}
      className={cn('cursor-pointer group', selected && 'bg-teal-50 border-l-2 border-l-teal-500')}
    >
      {/* Contact */}
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar call={call} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn('text-sm font-semibold truncate', MISSED_STATUSES.has(call.status) ? 'text-red-600' : 'text-gray-900')}>{name}</span>
              {call.callNotes.length > 0 && (
                <span className="w-4 h-4 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0">{call.callNotes.length}</span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <DirectionIcon direction={call.direction} size={11} />
              <span className="text-xs text-gray-400 truncate">{phone}</span>
            </div>
          </div>
        </div>
      </TableCell>

      {/* Duration */}
      <TableCell className="hidden md:table-cell">
        <span className="text-sm font-mono text-gray-600">{call.duration ? formatDuration(call.duration) : '—'}</span>
      </TableCell>

      {/* Status */}
      <TableCell className="hidden lg:table-cell">
        <StatusBadge status={resolveDisplayStatus(call)} />
      </TableCell>

      {/* Agent */}
      <TableCell className="hidden xl:table-cell">
        {call.user ? (
          <div className="flex items-center gap-1.5">
            <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0', avatarColor(call.user.id))}>{call.user.name[0]}</div>
            <span className="text-sm text-gray-700 truncate">{call.user.name.split(' ')[0]}</span>
          </div>
        ) : <span className="text-sm text-gray-400">—</span>}
      </TableCell>

      {/* Time + actions */}
      <TableCell className="w-28 pl-2" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1.5 relative">
          <span className="text-xs text-gray-400 group-hover:hidden">{timeAgo(call.createdAt)}</span>
          <div className="hidden group-hover:flex items-center gap-1">
            <button title="Call back" onClick={() => onDial(phone)}
              className="w-7 h-7 rounded-lg bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center transition-colors">
              <Phone size={12} className="text-white" />
            </button>
            <button onClick={() => setMenuOpen(p => !p)}
              className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
              <MoreVertical size={12} className="text-gray-600" />
            </button>
          </div>
          {menuOpen && (
            <CallContextMenu
              call={call} agents={agents} onClose={() => setMenuOpen(false)}
              onRefresh={onRefresh} onDial={onDial} onTransfer={onTransfer} onMessage={onMessage}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Stats Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, sub, color, onClick, active }: { label: string; value: number | string; icon: React.ReactNode; sub?: string; color: string; onClick?: () => void; active?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white border rounded-2xl px-5 py-4 flex items-center gap-4 transition-all',
        onClick ? 'cursor-pointer hover:shadow-md active:scale-[0.98]' : 'hover:shadow-sm',
        active ? 'border-teal-400 ring-2 ring-teal-400/20 shadow-sm' : 'border-gray-200',
      )}
    >
      <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p>
        {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { id: NavSection; label: string; icon: React.ReactNode }[] = [
  { id: 'all',       label: 'All Calls',  icon: <Phone size={13} /> },
  { id: 'missed',    label: 'Missed',     icon: <PhoneMissed size={13} /> },
  { id: 'incoming',  label: 'Incoming',   icon: <PhoneIncoming size={13} /> },
  { id: 'outgoing',  label: 'Outgoing',   icon: <PhoneOutgoing size={13} /> },
  { id: 'scheduled', label: 'Scheduled',  icon: <CalendarClock size={13} /> },
  { id: 'archived',  label: 'Archived',   icon: <Archive size={13} /> },
];

export default function CallsPage() {
  const router = useRouter();
  const { setActiveConversation } = useInboxStore();

  const [calls, setCalls] = useState<CallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const { outboundCall, setPendingDial } = useCallsStore();

  const [nav, setNav] = useState<NavSection>('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<'schedule' | 'link' | null>(null);
  const [transferTarget, setTransferTarget] = useState<CallLog | null>(null);

  const limit = 25;

  const navParams = (): Record<string, unknown> => {
    // 'MISSED' on the backend now filters status IN (MISSED, UNANSWERED)
    if (nav === 'missed')    return { status: 'MISSED' };
    if (nav === 'incoming')  return { direction: 'INBOUND' };
    if (nav === 'outgoing')  return { direction: 'OUTBOUND' };
    if (nav === 'scheduled') return { status: 'SCHEDULED' };
    if (nav === 'archived')  return { isArchived: 'true' };
    return {};
  };

  const loadCalls = useCallback(async (resetPage = false) => {
    setLoading(true);
    const p = resetPage ? 1 : page;
    if (resetPage) setPage(1);
    try {
      const [callsRes, statsRes] = await Promise.all([
        callsApi.list({ ...navParams(), search: search || undefined, page: p, limit, from: dateFrom || undefined, to: dateTo || undefined }),
        callsApi.stats(),
      ]);
      const d = callsRes.data as { data: CallLog[]; meta: { total: number } };
      setCalls(d.data ?? []);
      setTotal(d.meta?.total ?? 0);
      setStats(statsRes.data as Stats);
    } catch { setCalls([]); setTotal(0); }
    finally { setLoading(false); }
  }, [nav, search, dateFrom, dateTo, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadContacts = useCallback(async () => {
    try {
      const res = await contactsApi.list({ limit: 200 });
      const d = res.data as { data?: Contact[] } | Contact[];
      setContacts(Array.isArray(d) ? d : (d.data ?? []));
    } catch { /* non-critical */ }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const res = await usersApi.list();
      setAgents((res.data as Agent[]) ?? []);
    } catch { /* non-critical */ }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await callsApi.analytics();
      setAnalytics(res.data as Analytics);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { void loadCalls(true); }, [nav, search, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadCalls(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadContacts(); void loadAgents(); void loadAnalytics(); }, [loadContacts, loadAgents, loadAnalytics]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => { void loadCalls(true); void loadAnalytics(); };

    socket.on('call_created',    refresh);
    socket.on('call_updated',    refresh);
    socket.on('call_transferred', refresh);
    socket.on('call_ringing',    refresh);
    socket.on('call_connected',  refresh);
    socket.on('call_accepted',   refresh);
    socket.on('call_declined',   refresh);
    socket.on('call_missed',     refresh);
    socket.on('call_canceled',   refresh);
    socket.on('call_unanswered', refresh);
    socket.on('call_ended',      refresh);
    socket.on('incoming_call',   refresh);

    return () => {
      socket.off('call_created',    refresh);
      socket.off('call_updated',    refresh);
      socket.off('call_transferred', refresh);
      socket.off('call_ringing',    refresh);
      socket.off('call_connected',  refresh);
      socket.off('call_accepted',   refresh);
      socket.off('call_declined',   refresh);
      socket.off('call_missed',     refresh);
      socket.off('call_canceled',   refresh);
      socket.off('call_unanswered', refresh);
      socket.off('call_ended',      refresh);
      socket.off('incoming_call',   refresh);
    };
  }, [loadCalls, loadAnalytics]);

  const handleMessageContact = async (call: CallLog) => {
    if (!call.contact?.id) { toast.error('No contact linked to this call'); return; }
    try {
      const res = await conversationsApi.findOrCreate(call.contact.id);
      const conv = res.data as { id: string };
      setActiveConversation(conv.id);
      router.push('/inbox');
    } catch { toast.error('Failed to open conversation'); }
  };

  const openDial = (prefill = '') => { setPendingDial(prefill || ''); };
  const selected = selectedId ? calls.find(c => c.id === selectedId) ?? null : null;

  const tabCount = (id: NavSection): number | undefined => {
    if (!stats) return undefined;
    if (id === 'all') return stats.total;
    if (id === 'missed') return stats.missed;
    if (id === 'incoming') return stats.inbound;
    if (id === 'outgoing') return stats.outbound;
    if (id === 'scheduled') return stats.scheduled;
    return undefined;
  };

  return (
    <div className={cn('h-full flex flex-col overflow-hidden bg-gray-50/50', outboundCall && 'pb-20')}>

      {/* ── Page header ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Calls</h1>
            <p className="text-xs text-gray-500 mt-0.5">Manage and track all calls</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={() => { setShowAnalytics(p => !p); }}
              className={cn('flex items-center gap-2 px-3.5 py-2 border rounded-xl text-sm font-medium transition-colors',
                showAnalytics ? 'bg-teal-50 border-teal-200 text-teal-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
              <BarChart2 size={14} />Analytics
            </button>
            <button onClick={() => setModal('link')}
              className="flex items-center gap-2 px-3.5 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              <Link2 size={14} />Call Link
            </button>
            <button onClick={() => setModal('schedule')}
              className="flex items-center gap-2 px-3.5 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              <CalendarClock size={14} />Schedule
            </button>
            <button onClick={() => openDial()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-colors shadow-sm">
              <Phone size={14} />New Call
            </button>
          </div>
        </div>

        {/* Analytics banner */}
        {showAnalytics && analytics && <AnalyticsBanner analytics={analytics} />}

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
            <StatCard label="Total Calls" value={stats.total} icon={<Phone size={18} className="text-teal-600" />} sub={`${stats.todayTotal} today`} color="bg-teal-50" onClick={() => setNav('all')} active={nav === 'all'} />
            <StatCard label="Missed" value={stats.missed} icon={<PhoneMissed size={18} className="text-red-500" />} color="bg-red-50" onClick={() => setNav('missed')} active={nav === 'missed'} />
            <StatCard label="Inbound" value={stats.inbound} icon={<PhoneIncoming size={18} className="text-emerald-600" />} color="bg-emerald-50" onClick={() => setNav('incoming')} active={nav === 'incoming'} />
            <StatCard label="Outbound" value={stats.outbound} icon={<PhoneOutgoing size={18} className="text-blue-500" />} color="bg-blue-50" onClick={() => setNav('outgoing')} active={nav === 'outgoing'} />
            {stats.active > 0 ? (
              <StatCard label="Live Calls" value={stats.active} icon={<Activity size={18} className="text-orange-500" />} sub="Active now" color="bg-orange-50" onClick={() => setNav('all')} active={false} />
            ) : (
              <StatCard label="Scheduled" value={stats.scheduled} icon={<CalendarClock size={18} className="text-blue-600" />} color="bg-indigo-50" onClick={() => setNav('scheduled')} active={nav === 'scheduled'} />
            )}
          </div>
        )}

        {/* Tabs + search row */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {TABS.map(tab => {
              const count = tabCount(tab.id);
              return (
                <button key={tab.id} onClick={() => setNav(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap',
                    nav === tab.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700',
                  )}>
                  {tab.icon}
                  {tab.label}
                  {count !== undefined && count > 0 && (
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                      nav === tab.id
                        ? tab.id === 'missed' ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-700'
                        : 'bg-gray-200 text-gray-500',
                    )}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-gray-100 rounded-xl px-3 py-1.5 border-0">
              <span className="text-[11px] text-gray-400 font-medium whitespace-nowrap">From</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="bg-transparent text-xs text-gray-700 focus:outline-none w-28" />
              <span className="text-gray-300">—</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="bg-transparent text-xs text-gray-700 focus:outline-none w-28" />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-gray-400 hover:text-gray-600 ml-0.5">
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or number…"
                className="bg-gray-100 border-0 rounded-xl pl-8 pr-8 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:bg-white transition-colors w-44" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={12} /></button>}
            </div>
            <button onClick={() => void loadCalls(true)} title="Refresh"
              className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 bg-white transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden bg-white">

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="divide-y divide-gray-100">
                {Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)}
              </div>
            ) : calls.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                  <PhoneOff size={28} className="text-gray-400" />
                </div>
                <p className="text-base font-bold text-gray-700">No calls found</p>
                <p className="text-sm text-gray-400 mt-1 mb-5">
                  {search ? `No calls matching "${search}"` : 'No calls in this category yet'}
                </p>
                <button onClick={() => openDial()} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors">
                  <Plus size={15} />Make first call
                </button>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-gray-50 cursor-default">
                      <TableHead>Contact</TableHead>
                      <TableHead className="hidden md:table-cell">Duration</TableHead>
                      <TableHead className="hidden lg:table-cell">Status</TableHead>
                      <TableHead className="hidden xl:table-cell">Agent</TableHead>
                      <TableHead className="w-28 pl-2">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map(call => (
                      <CallRow
                        key={call.id} call={call} selected={selectedId === call.id} agents={agents}
                        onClick={() => setSelectedId(selectedId === call.id ? null : call.id)}
                        onDial={openDial}
                        onTransfer={setTransferTarget}
                        onMessage={call => { void handleMessageContact(call); }}
                        onRefresh={() => void loadCalls(true)}
                      />
                    ))}
                  </TableBody>
                </Table>
                {total > limit && (
                  <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50/50">
                    <span className="text-xs text-gray-500">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
                    <div className="flex items-center gap-2">
                      <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                        className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">← Prev</button>
                      <button disabled={page * limit >= total} onClick={() => setPage(p => p + 1)}
                        className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next →</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right detail panel */}
        {selected && (
          <CallDetail
            call={selected} agents={agents}
            onClose={() => setSelectedId(null)}
            onRefresh={() => void loadCalls()}
            onDial={openDial}
            onTransfer={setTransferTarget}
            onMessage={call => { void handleMessageContact(call); }}
          />
        )}
      </div>

      {/* Modals */}
      {modal === 'schedule' && <ScheduleModal contacts={contacts} onClose={() => setModal(null)} onScheduled={() => void loadCalls(true)} />}
      {modal === 'link'     && <CallLinkModal onClose={() => setModal(null)} />}
      {transferTarget       && <TransferModal call={transferTarget} agents={agents} onClose={() => setTransferTarget(null)} onTransferred={() => void loadCalls(true)} />}

    </div>
  );
}
