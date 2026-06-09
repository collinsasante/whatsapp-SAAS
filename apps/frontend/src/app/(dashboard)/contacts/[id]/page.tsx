'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Phone, Mail, Tag, MessageSquare,
  Edit2, Save, X, CheckCircle, Clock, User,
  Ban, Bell, BellOff, Trash2, Plus, Hash, Calendar,
  Activity, ChevronRight, FileText, StickyNote,
  ToggleLeft, ToggleRight, AlignLeft, Hash as NumberIcon,
} from 'lucide-react';
import { contactsApi, conversationsApi, activityLogApi, attributesApi } from '@/lib/api';
import { cn, getInitials, formatMessageTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import { showConfirm } from '@/store/confirm.store';

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700', 'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700', 'bg-orange-100 text-orange-700', 'bg-pink-100 text-pink-700',
];
function getAvatarColor(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

interface Contact {
  id: string; name: string | null; phone: string; email: string | null;
  avatarUrl: string | null; labels: string[]; customFields: Record<string, string>;
  isBlocked: boolean; optedOut: boolean; createdAt: string; updatedAt: string;
}
interface Conversation {
  id: string; status: string; lastMessageAt: string | null; unreadCount: number;
  messages?: Array<{ content: string | null; type: string }>;
  channel?: { type: string; name: string };
  assignedTo?: { name: string } | null;
}
interface Activity {
  id: string; action: string; metadata: Record<string, unknown>; createdAt: string;
  user?: { name: string } | null;
}
interface Note {
  id: string; content: string; createdAt: string;
  author?: { name: string } | null;
  conversationId: string;
}
interface Attribute {
  id: string; name: string; key: string; type: string; options: string[];
}

const statusColor = (s: string) =>
  s === 'OPEN' ? 'text-teal-600 bg-teal-50' :
  s === 'RESOLVED' ? 'text-green-600 bg-green-50' :
  s === 'PENDING' ? 'text-orange-600 bg-orange-50' : 'text-gray-600 bg-gray-100';

const ATTR_ICON: Record<string, React.ElementType> = {
  TEXT: AlignLeft, NUMBER: NumberIcon, DATE: Calendar,
  BOOLEAN: ToggleLeft, DROPDOWN: Hash,
};

export default function ContactProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();

  const [contact, setContact] = useState<Contact | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'conversations' | 'notes' | 'activity'>('overview');

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '' });

  const [editingAttrs, setEditingAttrs] = useState(false);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [savingAttrs, setSavingAttrs] = useState(false);

  const [noteInput, setNoteInput] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, convRes, attrRes] = await Promise.allSettled([
        contactsApi.get(id),
        conversationsApi.list({ contactId: id, limit: 30 }),
        attributesApi.list(),
      ]);

      let fetchedContact: Contact | null = null;
      if (cRes.status === 'fulfilled') {
        fetchedContact = cRes.value.data as Contact;
        setContact(fetchedContact);
        setEditForm({ name: fetchedContact.name ?? '', email: fetchedContact.email ?? '', phone: fetchedContact.phone });
        setAttrValues(fetchedContact.customFields ?? {});
      }
      if (attrRes.status === 'fulfilled') {
        setAttributes((attrRes.value.data as Attribute[]) ?? []);
      }

      let fetchedConvs: Conversation[] = [];
      if (convRes.status === 'fulfilled') {
        fetchedConvs = ((convRes.value.data as { data: Conversation[] }).data) ?? [];
        setConversations(fetchedConvs);
      }

      // Load notes + activities from conversations
      const convIds = fetchedConvs.slice(0, 5).map((c) => c.id);
      if (convIds.length > 0) {
        const [actResults, noteResults] = await Promise.all([
          Promise.allSettled(convIds.slice(0, 3).map((cid) => activityLogApi.forConversation(cid))),
          Promise.allSettled(convIds.map((cid) => conversationsApi.getNotes(cid).then(r => ({ cid, data: r.data })))),
        ]);

        const allActs: Activity[] = [];
        actResults.forEach((r) => { if (r.status === 'fulfilled') allActs.push(...(r.value.data as Activity[])); });
        setActivities(allActs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30));

        const allNotes: Note[] = [];
        noteResults.forEach((r) => {
          if (r.status === 'fulfilled') {
            const { cid, data } = r.value as { cid: string; data: Note[] };
            (data ?? []).forEach(n => allNotes.push({ ...n, conversationId: cid }));
          }
        });
        setNotes(allNotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      }
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!contact) return;
    setSaving(true);
    try {
      const res = await contactsApi.update(id, { name: editForm.name || null, email: editForm.email || null, phone: editForm.phone });
      setContact(res.data as Contact);
      setEditing(false);
      toast.success('Contact updated');
    } catch { toast.error('Failed to update'); }
    finally { setSaving(false); }
  };

  const handleSaveAttrs = async () => {
    if (!contact) return;
    setSavingAttrs(true);
    try {
      const merged = { ...(contact.customFields ?? {}), ...attrValues };
      const res = await contactsApi.update(id, { customFields: merged });
      setContact(res.data as Contact);
      setEditingAttrs(false);
      toast.success('Attributes saved');
    } catch { toast.error('Failed to save attributes'); }
    finally { setSavingAttrs(false); }
  };

  const handleAddLabel = async () => {
    if (!contact || !labelInput.trim()) return;
    const labels = [...contact.labels, labelInput.trim()];
    try {
      await contactsApi.update(id, { labels });
      setContact({ ...contact, labels });
      setLabelInput('');
    } catch { toast.error('Failed to add label'); }
  };

  const handleRemoveLabel = async (label: string) => {
    if (!contact) return;
    const labels = contact.labels.filter((l) => l !== label);
    try {
      await contactsApi.update(id, { labels });
      setContact({ ...contact, labels });
    } catch { toast.error('Failed to remove label'); }
  };

  const handleBlock = async () => {
    if (!contact) return;
    try {
      await contactsApi.update(id, { isBlocked: !contact.isBlocked });
      setContact({ ...contact, isBlocked: !contact.isBlocked });
      toast.success(contact.isBlocked ? 'Contact unblocked' : 'Contact blocked');
    } catch { toast.error('Failed to update'); }
  };

  const handleOptOut = async () => {
    if (!contact) return;
    try {
      await contactsApi.update(id, { optedOut: !contact.optedOut });
      setContact({ ...contact, optedOut: !contact.optedOut });
      toast.success(contact.optedOut ? 'Contact opted in' : 'Contact opted out');
    } catch { toast.error('Failed to update'); }
  };

  const handleDelete = async () => {
    if (!await showConfirm('Delete this contact?', { subtext: 'This cannot be undone.' })) return;
    try {
      await contactsApi.delete(id);
      toast.success('Contact deleted');
      router.push('/contacts');
    } catch { toast.error('Failed to delete'); }
  };

  const handleStartConversation = async () => {
    try {
      const res = await conversationsApi.findOrCreate(id);
      const convId = (res.data as { id: string }).id;
      router.push(`/inbox?conversation=${convId}`);
    } catch { toast.error('Failed to start conversation'); }
  };

  const handleAddNote = async () => {
    if (!noteInput.trim() || conversations.length === 0) return;
    setAddingNote(true);
    const latestConvId = conversations[0].id;
    try {
      const res = await conversationsApi.addNote(latestConvId, noteInput.trim());
      const newNote = res.data as Note;
      setNotes(prev => [{ ...newNote, conversationId: latestConvId }, ...prev]);
      setNoteInput('');
      toast.success('Note added');
    } catch { toast.error('Failed to add note'); }
    finally { setAddingNote(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
    </div>
  );
  if (!contact) return (
    <div className="flex items-center justify-center h-full text-gray-400">Contact not found</div>
  );

  const displayName = contact.name ?? contact.phone;
  const avatarColor = getAvatarColor(displayName);
  const totalConvs = conversations.length;
  const resolvedConvs = conversations.filter((c) => c.status === 'RESOLVED').length;
  const openConvs = conversations.filter((c) => c.status === 'OPEN').length;

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto p-6 space-y-5">

        {/* Back + actions */}
        <div className="flex items-center justify-between">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            <ArrowLeft size={16} />Back to Contacts
          </button>
          <button onClick={() => void handleStartConversation()}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-xl transition-colors">
            <MessageSquare size={14} />Message
          </button>
        </div>

        {/* Profile header */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-start gap-5">
            <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold flex-shrink-0', avatarColor)}>
              {getInitials(displayName)}
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Name</label>
                      <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Name" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                      <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Phone" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500 mb-1 block">Email</label>
                      <input value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Email" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => void handleSave()} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-60">
                      <Save size={14} />{saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-200">
                      <X size={14} />Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-xl font-bold text-gray-900">{displayName}</h1>
                    {contact.isBlocked && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Blocked</span>}
                    {contact.optedOut && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">Opted Out</span>}
                  </div>
                  <div className="flex items-center flex-wrap gap-4 mt-2">
                    <div className="flex items-center gap-1.5 text-sm text-gray-500"><Phone size={13} />{contact.phone}</div>
                    {contact.email && <div className="flex items-center gap-1.5 text-sm text-gray-500"><Mail size={13} />{contact.email}</div>}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Added {new Date(contact.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </>
              )}
            </div>
            {!editing && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setEditing(true)} title="Edit" className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors">
                  <Edit2 size={15} />
                </button>
                <button onClick={() => void handleBlock()} title={contact.isBlocked ? 'Unblock' : 'Block'}
                  className={cn('w-9 h-9 flex items-center justify-center rounded-xl transition-colors', contact.isBlocked ? 'text-red-600 bg-red-50' : 'text-gray-400 hover:text-red-600 hover:bg-red-50')}>
                  <Ban size={15} />
                </button>
                <button onClick={() => void handleOptOut()} title={contact.optedOut ? 'Opt in' : 'Opt out'}
                  className={cn('w-9 h-9 flex items-center justify-center rounded-xl transition-colors', contact.optedOut ? 'text-orange-600 bg-orange-50' : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50')}>
                  {contact.optedOut ? <BellOff size={15} /> : <Bell size={15} />}
                </button>
                <button onClick={() => void handleDelete()} title="Delete" className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Conversations', value: totalConvs, icon: MessageSquare, cls: 'bg-teal-50 border-teal-100' },
            { label: 'Open', value: openConvs, icon: Clock, cls: 'bg-blue-50 border-blue-100' },
            { label: 'Resolved', value: resolvedConvs, icon: CheckCircle, cls: 'bg-green-50 border-green-100' },
            { label: 'Notes', value: notes.length, icon: StickyNote, cls: 'bg-orange-50 border-orange-100' },
          ].map(({ label, value, icon: Icon, cls }) => (
            <div key={label} className={cn('bg-white border rounded-2xl p-4', cls)}>
              <Icon size={16} className="text-gray-400 mb-2" />
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1 w-fit">
          {(['overview', 'conversations', 'notes', 'activity'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-4 py-1.5 text-sm rounded-xl transition-colors font-medium capitalize',
                tab === t ? 'bg-teal-600 text-white' : 'text-gray-500 hover:text-gray-700')}>
              {t}
              {t === 'notes' && notes.length > 0 && (
                <span className={cn('ml-1.5 text-xs px-1.5 py-0.5 rounded-full', tab === t ? 'bg-white/20' : 'bg-gray-100')}>
                  {notes.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Contact details */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <User size={14} className="text-teal-600" />
                <h3 className="text-sm font-semibold text-gray-900">Contact Details</h3>
              </div>
              <div className="space-y-0">
                <DetailRow icon={Phone} label="Phone" value={contact.phone} />
                <DetailRow icon={Mail} label="Email" value={contact.email ?? '—'} />
                <DetailRow icon={Calendar} label="Added" value={new Date(contact.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} />
                <DetailRow icon={Calendar} label="Updated" value={new Date(contact.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} />
              </div>
            </div>

            {/* Labels */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Tag size={14} className="text-teal-600" />
                <h3 className="text-sm font-semibold text-gray-900">Labels</h3>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {contact.labels.length === 0 && <p className="text-xs text-gray-400">No labels yet</p>}
                {contact.labels.map((l) => (
                  <span key={l} className="flex items-center gap-1 text-xs bg-teal-50 text-teal-700 border border-teal-100 px-2.5 py-1 rounded-full">
                    <Hash size={10} />{l}
                    <button onClick={() => void handleRemoveLabel(l)} className="ml-1 text-teal-400 hover:text-teal-600"><X size={10} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={labelInput} onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddLabel(); } }}
                  placeholder="Add label…" className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <button onClick={() => void handleAddLabel()} disabled={!labelInput.trim()}
                  className="px-2.5 py-1.5 bg-teal-600 text-white text-xs rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  <Plus size={12} />
                </button>
              </div>
            </div>

            {/* Custom Attributes */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-teal-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Attributes</h3>
                  {attributes.length === 0 && (
                    <span className="text-xs text-gray-400">(Define attributes in Manage → Attributes)</span>
                  )}
                </div>
                {attributes.length > 0 && !editingAttrs && (
                  <button onClick={() => setEditingAttrs(true)} className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium">
                    <Edit2 size={12} />Edit
                  </button>
                )}
                {editingAttrs && (
                  <div className="flex gap-2">
                    <button onClick={() => void handleSaveAttrs()} disabled={savingAttrs}
                      className="flex items-center gap-1 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 disabled:opacity-60">
                      <Save size={11} />{savingAttrs ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => { setEditingAttrs(false); setAttrValues(contact.customFields ?? {}); }}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5">Cancel</button>
                  </div>
                )}
              </div>

              {attributes.length === 0 ? (
                <p className="text-xs text-gray-400">No attributes defined. Go to Manage → Attributes to create them.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {attributes.map((attr) => {
                    const IconComp = ATTR_ICON[attr.type] ?? AlignLeft;
                    const val = attrValues[attr.key] ?? '';
                    return (
                      <div key={attr.id}>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1.5">
                          <IconComp size={11} />{attr.name}
                        </label>
                        {editingAttrs ? (
                          attr.type === 'BOOLEAN' ? (
                            <button onClick={() => setAttrValues(v => ({ ...v, [attr.key]: val === 'true' ? 'false' : 'true' }))}
                              className="flex items-center gap-2 text-sm text-gray-700">
                              {val === 'true' ? <ToggleRight size={22} className="text-teal-600" /> : <ToggleLeft size={22} className="text-gray-400" />}
                              <span>{val === 'true' ? 'Yes' : 'No'}</span>
                            </button>
                          ) : attr.type === 'DROPDOWN' && attr.options?.length ? (
                            <select value={val} onChange={(e) => setAttrValues(v => ({ ...v, [attr.key]: e.target.value }))}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                              <option value="">Select…</option>
                              {attr.options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : attr.type === 'DATE' ? (
                            <input type="date" value={val}
                              onChange={(e) => setAttrValues(v => ({ ...v, [attr.key]: e.target.value }))}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          ) : attr.type === 'NUMBER' ? (
                            <input type="number" value={val}
                              onChange={(e) => setAttrValues(v => ({ ...v, [attr.key]: e.target.value }))}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          ) : (
                            <input type="text" value={val}
                              onChange={(e) => setAttrValues(v => ({ ...v, [attr.key]: e.target.value }))}
                              placeholder={`Enter ${attr.name.toLowerCase()}…`}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          )
                        ) : (
                          <p className={cn('text-sm', val ? 'text-gray-800 font-medium' : 'text-gray-400 italic')}>
                            {attr.type === 'BOOLEAN' ? (val === 'true' ? 'Yes' : val === 'false' ? 'No' : '—') : val || '—'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Conversations tab ── */}
        {tab === 'conversations' && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-teal-600" />
                <h3 className="text-sm font-semibold text-gray-900">Conversations ({totalConvs})</h3>
              </div>
              <button onClick={() => void handleStartConversation()}
                className="flex items-center gap-1.5 text-xs text-teal-600 font-medium hover:text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors">
                <Plus size={12} />New
              </button>
            </div>
            {conversations.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">No conversations yet</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {conversations.map((conv) => (
                  <button key={conv.id}
                    onClick={() => router.push(`/inbox?conversation=${conv.id}`)}
                    className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left">
                    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0', statusColor(conv.status))}>
                      {conv.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">
                        {conv.messages?.[0]?.content ?? conv.messages?.[0]?.type ?? 'No messages'}
                      </p>
                      {conv.assignedTo && (
                        <p className="text-xs text-gray-400 mt-0.5">Assigned to {conv.assignedTo.name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {conv.lastMessageAt && <span className="text-xs text-gray-400">{formatMessageTime(conv.lastMessageAt)}</span>}
                      {conv.channel && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{conv.channel.name}</span>
                      )}
                      <ChevronRight size={14} className="text-gray-300" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Notes tab ── */}
        {tab === 'notes' && (
          <div className="space-y-4">
            {/* Add note */}
            {conversations.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Plus size={14} className="text-teal-600" />Add Note
                </h3>
                <textarea
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Write an internal note about this contact…"
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button onClick={() => void handleAddNote()} disabled={addingNote || !noteInput.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-50">
                    <Save size={13} />{addingNote ? 'Saving…' : 'Save Note'}
                  </button>
                </div>
              </div>
            )}

            {/* Notes list */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <StickyNote size={14} className="text-teal-600" />Notes ({notes.length})
                </h3>
              </div>
              {notes.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                  <StickyNote size={32} className="mx-auto mb-2 opacity-20" />
                  No notes yet
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {notes.map((note) => (
                    <div key={note.id} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {note.author?.name ? note.author.name[0].toUpperCase() : 'S'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-gray-700">{note.author?.name ?? 'System'}</span>
                            <span className="text-xs text-gray-400">{formatMessageTime(note.createdAt)}</span>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Activity tab ── */}
        {tab === 'activity' && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-teal-600" />
                <h3 className="text-sm font-semibold text-gray-900">Activity Timeline</h3>
              </div>
            </div>
            {activities.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">No activity recorded</div>
            ) : (
              <div className="p-5">
                <div className="relative pl-4 border-l-2 border-gray-100 space-y-4">
                  {activities.map((a) => (
                    <div key={a.id} className="relative">
                      <div className="absolute -left-5 w-3 h-3 rounded-full bg-teal-400 border-2 border-white" />
                      <div className="bg-gray-50 rounded-xl px-4 py-3">
                        <p className="text-xs text-gray-700">
                          <span className="font-semibold text-gray-900">{a.user?.name ?? 'System'}</span>{' '}
                          {a.action.toLowerCase().replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatMessageTime(a.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-gray-50 last:border-0">
      <Icon size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
      <span className="text-xs text-gray-500 w-20 flex-shrink-0">{label}</span>
      <span className="text-xs font-medium text-gray-800 truncate">{value}</span>
    </div>
  );
}
