'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Tag, Sliders, Webhook, MessageSquare, Clock, PhoneOff, Globe, QrCode,
  Plus, Trash2, Edit2, Check, X, Copy, RefreshCw, ToggleLeft, ToggleRight,
  Users, UserPlus, UserMinus, UserCog, Star, Hash, Search, Folder, FolderPlus,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { tagsApi, attributesApi, webhooksApi, manageSettingsApi, teamsApi, cannedResponsesApi } from '@/lib/api';
import { TeamManagement } from '@/components/shared/TeamManagement';
import toast from 'react-hot-toast';
import { showConfirm } from '@/store/confirm.store';

// ─────────────────── types ───────────────────
interface TagItem { id: string; name: string; color: string }
interface Attribute { id: string; key: string; label: string; type: string; options: string[]; isRequired: boolean; sortOrder: number }
interface WebhookItem { id: string; name: string; url: string; events: string[]; secret?: string; isActive: boolean; failureCount: number; lastTriggeredAt?: string }
interface ManageSettings {
  welcomeEnabled?: boolean; welcomeMessage?: string;
  offHoursEnabled?: boolean; offHoursMessage?: string; offHoursSchedule?: Record<string, { enabled: boolean; start: string; end: string }>;
  optOutKeywords?: string[]; optInKeywords?: string[]; optOutReply?: string; optInReply?: string;
  widgetEnabled?: boolean; widgetConfig?: Record<string, unknown>;
}

const SECTIONS = [
  { id: 'members', icon: UserCog, label: 'Members' },
  { id: 'teams', icon: Users, label: 'Teams' },
  { id: 'canned', icon: MessageSquare, label: 'Canned Responses' },
  { id: 'tags', icon: Tag, label: 'Tags' },
  { id: 'attributes', icon: Sliders, label: 'Attributes' },
  { id: 'welcome', icon: MessageSquare, label: 'Welcome Message' },
  { id: 'offhours', icon: Clock, label: 'Off-Hours' },
  { id: 'optinout', icon: PhoneOff, label: 'Opt-In / Opt-Out' },
  { id: 'webhooks', icon: Webhook, label: 'Webhooks' },
  { id: 'widget', icon: Globe, label: 'Website Widget' },
  { id: 'qrcode', icon: QrCode, label: 'QR Code' },
];

const WEBHOOK_EVENTS = [
  'message.received', 'message.sent', 'message.delivered', 'message.read',
  'conversation.created', 'conversation.resolved', 'conversation.assigned',
  'contact.created', 'contact.updated', 'campaign.completed',
];

const ATTR_TYPES = ['TEXT', 'NUMBER', 'DROPDOWN', 'DATE', 'BOOLEAN'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TAG_COLORS = ['#0d9488', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#ef4444', '#f59e0b', '#6366f1', '#64748b'];

// ─────────────────── Canned Responses Section ────────
const INPUT = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-gray-50 focus:bg-white';
const BTN_PRIMARY = 'px-5 py-2.5 bg-teal-600 text-white text-sm rounded-xl font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors';

const CATEGORY_COLORS = ['#6B7280','#0d9488','#3b82f6','#8b5cf6','#ec4899','#f97316','#10b981','#ef4444','#f59e0b'];

interface CannedCategory { id: string; name: string; color: string; icon?: string | null; _count: { cannedResponses: number } }
interface CannedItem {
  id: string; title: string; shortcut: string; content: string;
  categoryId?: string | null; category?: { id: string; name: string; color: string } | null;
  tags: string[]; mediaUrl?: string | null; mediaType?: string | null;
  isFavorite: boolean; usageCount: number;
  createdBy: { id: string; name: string };
}

const VARIABLES = ['{{customer_name}}', '{{agent_name}}', '{{phone}}', '{{email}}', '{{ticket_id}}', '{{current_date}}', '{{current_time}}'];

function CannedResponsesSection() {
  const [canned, setCanned] = useState<CannedItem[]>([]);
  const [categories, setCategories] = useState<CannedCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CannedItem | null>(null);
  const [form, setForm] = useState({
    title: '', shortcut: '', content: '', categoryId: '',
    tagsInput: '', mediaUrl: '',
  });
  const [saving, setSaving] = useState(false);
  // Category management
  const [showCatForm, setShowCatForm] = useState(false);
  const [editCat, setEditCat] = useState<CannedCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: '', color: '#6B7280' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, catsRes] = await Promise.all([
        cannedResponsesApi.list(),
        cannedResponsesApi.listCategories(),
      ]);
      setCanned(itemsRes.data as CannedItem[]);
      setCategories(catsRes.data as CannedCategory[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = canned.filter((c) => {
    const matchesCat = !selectedCat || c.categoryId === selectedCat;
    const q = search.toLowerCase();
    const matchesSearch = !q || c.shortcut.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.content.toLowerCase().includes(q) || c.tags.some(t => t.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', shortcut: '', content: '', categoryId: selectedCat ?? '', tagsInput: '', mediaUrl: '' });
    setShowForm(true);
  };

  const openEdit = (c: CannedItem) => {
    setEditing(c);
    setForm({ title: c.title, shortcut: c.shortcut, content: c.content, categoryId: c.categoryId ?? '', tagsInput: c.tags.join(', '), mediaUrl: c.mediaUrl ?? '' });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.shortcut.trim() || !form.content.trim()) { toast.error('Shortcut and content are required'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        shortcut: form.shortcut.trim().toLowerCase().replace(/\s+/g, '-'),
        content: form.content.trim(),
        categoryId: form.categoryId || undefined,
        tags: form.tagsInput.split(',').map(t => t.trim()).filter(Boolean),
        mediaUrl: form.mediaUrl.trim() || undefined,
        mediaType: form.mediaUrl.trim() ? 'image' : undefined,
      };
      if (editing) {
        await cannedResponsesApi.update(editing.id, { ...payload, categoryId: form.categoryId || null });
        toast.success('Updated');
      } else {
        await cannedResponsesApi.create(payload);
        toast.success('Created');
      }
      setShowForm(false);
      setEditing(null);
      void load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!await showConfirm('Delete this canned response?', { subtext: 'This cannot be undone.' })) return;
    try { await cannedResponsesApi.delete(id); void load(); toast.success('Deleted'); }
    catch { toast.error('Failed to delete'); }
  };

  const saveCat = async () => {
    if (!catForm.name.trim()) { toast.error('Category name required'); return; }
    try {
      if (editCat) {
        await cannedResponsesApi.updateCategory(editCat.id, catForm);
        toast.success('Category updated');
      } else {
        await cannedResponsesApi.createCategory(catForm);
        toast.success('Category created');
      }
      setShowCatForm(false);
      setEditCat(null);
      void load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save category');
    }
  };

  const deleteCat = async (id: string) => {
    if (!await showConfirm('Delete this category?', { subtext: 'Responses will be uncategorized.' })) return;
    try { await cannedResponsesApi.deleteCategory(id); void load(); }
    catch { toast.error('Failed to delete category'); }
  };

  const insertVar = (v: string) => {
    setForm(f => ({ ...f, content: f.content + v }));
  };

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Canned Responses</h2>
          <p className="text-sm text-gray-500">Pre-written replies. Type <code className="bg-gray-100 px-1 rounded text-xs">/shortcut</code> in the inbox to insert.</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors">
          <Plus size={14} /> New Response
        </button>
      </div>

      <div className="flex gap-5">
        {/* Categories sidebar */}
        <div className="w-44 flex-shrink-0 space-y-1">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Categories</span>
            <button onClick={() => { setEditCat(null); setCatForm({ name: '', color: '#6B7280' }); setShowCatForm(true); }}
              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
              <FolderPlus size={13} />
            </button>
          </div>
          <button onClick={() => setSelectedCat(null)}
            className={cn('w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm transition-colors',
              !selectedCat ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-100')}>
            <Folder size={14} className="flex-shrink-0" />
            <span className="flex-1 text-left">All</span>
            <span className={cn('text-[10px] rounded-full px-1.5 py-0.5', !selectedCat ? 'bg-teal-200 text-teal-700' : 'bg-gray-200 text-gray-500')}>
              {canned.length}
            </span>
          </button>
          {categories.map(cat => (
            <div key={cat.id} className="group relative">
              <button onClick={() => setSelectedCat(selectedCat === cat.id ? null : cat.id)}
                className={cn('w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm transition-colors',
                  selectedCat === cat.id ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-100')}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="flex-1 text-left truncate">{cat.name}</span>
                <span className={cn('text-[10px] rounded-full px-1.5 py-0.5 flex-shrink-0', selectedCat === cat.id ? 'bg-teal-200 text-teal-700' : 'bg-gray-200 text-gray-500')}>
                  {cat._count.cannedResponses}
                </span>
              </button>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                <button onClick={(e) => { e.stopPropagation(); setEditCat(cat); setCatForm({ name: cat.name, color: cat.color }); setShowCatForm(true); }}
                  className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-blue-600 bg-white rounded">
                  <Edit2 size={9} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); void deleteCat(cat.id); }}
                  className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-500 bg-white rounded">
                  <Trash2 size={9} />
                </button>
              </div>
            </div>
          ))}

          {/* Category form */}
          {showCatForm && (
            <div className="mt-2 p-3 bg-white border border-teal-200 rounded-xl shadow-sm space-y-2">
              <input value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Category name" className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500" />
              <div className="flex flex-wrap gap-1">
                {CATEGORY_COLORS.map(c => (
                  <button key={c} onClick={() => setCatForm(f => ({ ...f, color: c }))}
                    className="w-4 h-4 rounded-full transition-transform"
                    style={{ backgroundColor: c, transform: catForm.color === c ? 'scale(1.3)' : undefined, outline: catForm.color === c ? `2px solid ${c}` : undefined, outlineOffset: '1px' }} />
                ))}
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => { void saveCat(); }}
                  className="flex-1 py-1 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700">{editCat ? 'Save' : 'Create'}</button>
                <button onClick={() => { setShowCatForm(false); setEditCat(null); }}
                  className="flex-1 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search responses…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-gray-50 focus:bg-white" />
          </div>

          {/* Form */}
          {showForm && (
            <div className="bg-white border border-teal-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">{editing ? 'Edit Response' : 'New Canned Response'}</h3>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                    <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                      placeholder="Welcome Message" className={INPUT} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Shortcut <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">/</span>
                      <input value={form.shortcut} onChange={e => setForm(f => ({ ...f, shortcut: e.target.value.replace(/\s+/g, '-').toLowerCase() }))}
                        placeholder="welcome" className={cn(INPUT, 'pl-6')} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                    <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
                      className={INPUT}>
                      <option value="">— None —</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Tags (comma separated)</label>
                    <input value={form.tagsInput} onChange={e => setForm(f => ({ ...f, tagsInput: e.target.value }))}
                      placeholder="billing, urgent, refund" className={INPUT} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-600">Content <span className="text-red-500">*</span></label>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {VARIABLES.map(v => (
                        <button key={v} onClick={() => insertVar(v)}
                          className="text-[9px] bg-teal-50 text-teal-600 border border-teal-200 px-1.5 py-0.5 rounded hover:bg-teal-100 transition-colors font-mono">
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea rows={5} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                    placeholder={`Hi {{customer_name}},\n\nWelcome to {{company_name}}! How can we help you today?`}
                    className={cn(INPUT, 'resize-none font-mono text-xs leading-relaxed')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Media URL (optional)</label>
                  <input value={form.mediaUrl} onChange={e => setForm(f => ({ ...f, mediaUrl: e.target.value }))}
                    placeholder="https://example.com/image.jpg" className={INPUT} />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button onClick={() => { void save(); }} disabled={saving} className={BTN_PRIMARY}>
                  {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2.5 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50 transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-sm">
              <MessageSquare size={28} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-500">{search ? 'No matching responses' : 'No canned responses yet'}</p>
              <p className="text-xs text-gray-400 mt-1">{search ? 'Try a different search term' : 'Create shortcuts for your most common replies'}</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
              {filtered.map((c, i) => (
                <div key={c.id} className={cn('flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group', i > 0 && 'border-t border-gray-100')}>
                  <code className="text-[11px] bg-teal-50 text-teal-700 px-2 py-1 rounded-lg font-mono flex-shrink-0 mt-0.5">/{c.shortcut}</code>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {c.title && <span className="text-sm font-medium text-gray-800 truncate">{c.title}</span>}
                      {c.category && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium flex-shrink-0"
                          style={{ backgroundColor: c.category.color }}>{c.category.name}</span>
                      )}
                      {c.isFavorite && <Star size={10} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
                      {c.mediaUrl && <span className="text-[9px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full flex-shrink-0">📎 Media</span>}
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{c.content}</p>
                    {c.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {c.tags.map(t => <span key={t} className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">{t}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
                    <button onClick={() => openEdit(c)}
                      className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                      <Edit2 size={12} />
                    </button>
                    <button onClick={() => { void remove(c.id); }}
                      className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Teams Section ───────────────────
interface TeamUser { id: string; name: string; email: string; avatarUrl: string | null; role: string }
interface TeamMemberItem { id: string; userId: string; user: TeamUser | null }
interface TeamItem { id: string; name: string; description: string | null; members: TeamMemberItem[] }

function TeamsSection() {
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [allUsers, setAllUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Create / Edit
  const [showCreate, setShowCreate] = useState(false);
  const [editTeam, setEditTeam] = useState<TeamItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [saving, setSaving] = useState(false);
  // Add member picker
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [memberUserId, setMemberUserId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamsRes, usersRes] = await Promise.all([teamsApi.list(), teamsApi.getUsers()]);
      setTeams(teamsRes.data as TeamItem[]);
      setAllUsers(usersRes.data as TeamUser[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setFormName(''); setFormDesc(''); setEditTeam(null); setShowCreate(true); };
  const openEdit = (t: TeamItem) => { setFormName(t.name); setFormDesc(t.description ?? ''); setEditTeam(t); setShowCreate(true); };

  const saveTeam = async () => {
    if (!formName.trim()) { toast.error('Team name required'); return; }
    setSaving(true);
    try {
      if (editTeam) {
        await teamsApi.update(editTeam.id, { name: formName, description: formDesc });
        toast.success('Team updated');
      } else {
        await teamsApi.create({ name: formName, description: formDesc || undefined });
        toast.success('Team created');
      }
      setShowCreate(false);
      void load();
    } catch { toast.error('Failed to save team'); }
    finally { setSaving(false); }
  };

  const deleteTeam = async (id: string) => {
    if (!await showConfirm('Delete this team?', { subtext: 'This cannot be undone.' })) return;
    try { await teamsApi.delete(id); toast.success('Team deleted'); void load(); }
    catch { toast.error('Failed to delete team'); }
  };

  const addMember = async () => {
    if (!addMemberTeamId || !memberUserId) return;
    try {
      await teamsApi.addMember(addMemberTeamId, memberUserId);
      toast.success('Member added');
      setAddMemberTeamId(null);
      setMemberUserId('');
      void load();
    } catch { toast.error('User already in team or not found'); }
  };

  const removeMember = async (teamId: string, userId: string) => {
    try { await teamsApi.removeMember(teamId, userId); void load(); }
    catch { toast.error('Failed to remove member'); }
  };

  function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Teams</h2>
          <p className="text-sm text-gray-500">Organise agents into teams for routing and reporting</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors">
          <Plus size={14} /> New Team
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
      ) : teams.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">No teams yet. Create one to organise your agents.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map(team => (
            <div key={team.id} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3.5 bg-white">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-teal-100 rounded-xl flex items-center justify-center">
                    <Users size={14} className="text-teal-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{team.name}</p>
                    {team.description && <p className="text-xs text-gray-400">{team.description}</p>}
                  </div>
                  <span className="text-xs text-gray-400 ml-2">{team.members.length} member{team.members.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setExpandedId(expandedId === team.id ? null : team.id)}
                    className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors text-xs font-medium">
                    {expandedId === team.id ? '▲' : '▼'}
                  </button>
                  <button onClick={() => openEdit(team)}
                    className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => { void deleteTeam(team.id); }}
                    className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {expandedId === team.id && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Members</p>
                    <button onClick={() => { setAddMemberTeamId(team.id); setMemberUserId(''); }}
                      className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
                      <UserPlus size={12} /> Add member
                    </button>
                  </div>

                  {team.members.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">No members yet</p>
                  ) : (
                    <div className="space-y-2">
                      {team.members.map(m => {
                        const u = m.user;
                        if (!u) return null;
                        return (
                          <div key={m.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2.5">
                              {u.avatarUrl ? (
                                <img src={u.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-[10px] font-bold">
                                  {initials(u.name)}
                                </div>
                              )}
                              <div>
                                <p className="text-xs font-medium text-gray-800">{u.name}</p>
                                <p className="text-[10px] text-gray-400">{u.role.toLowerCase()}</p>
                              </div>
                            </div>
                            <button onClick={() => { void removeMember(team.id, m.userId); }}
                              className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors">
                              <UserMinus size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add member picker */}
                  {addMemberTeamId === team.id && (
                    <div className="mt-3 flex items-center gap-2">
                      <select value={memberUserId} onChange={e => setMemberUserId(e.target.value)}
                        className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                        <option value="">Select agent…</option>
                        {allUsers
                          .filter(u => !team.members.some(m => m.userId === u.id))
                          .map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                      </select>
                      <button onClick={() => { void addMember(); }} disabled={!memberUserId}
                        className="px-3 py-1.5 bg-teal-600 text-white text-xs rounded-lg hover:bg-teal-700 disabled:opacity-50">
                        Add
                      </button>
                      <button onClick={() => setAddMemberTeamId(null)} className="text-gray-400 hover:text-gray-600">
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">{editTeam ? 'Edit Team' : 'New Team'}</h3>
              <button onClick={() => setShowCreate(false)}><X size={16} className="text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team Name *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Sales Team"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional description"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
              <button onClick={() => { void saveTeam(); }} disabled={saving}
                className="flex-1 py-2.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-60 font-medium">
                {editTeam ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────── Tags Section ───────────────────
function TagsSection() {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#0d9488');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  useEffect(() => {
    tagsApi.list().then(r => setTags(r.data));
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const r = await tagsApi.create({ name: newName.trim(), color: newColor });
    setTags(prev => [...prev, r.data]);
    setNewName('');
  };

  const handleDelete = async (id: string) => {
    await tagsApi.delete(id);
    setTags(prev => prev.filter(t => t.id !== id));
  };

  const startEdit = (tag: TagItem) => { setEditId(tag.id); setEditName(tag.name); setEditColor(tag.color); };

  const saveEdit = async () => {
    if (!editId) return;
    const r = await tagsApi.update(editId, { name: editName, color: editColor });
    setTags(prev => prev.map(t => t.id === editId ? r.data : t));
    setEditId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Tags</h2>
        <p className="text-sm text-gray-500 mt-1">Organize contacts and conversations with color-coded labels.</p>
      </div>
      {/* Create */}
      <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="Tag name..."
          className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <div className="flex items-center gap-2">
          {TAG_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setNewColor(c)}
              className="w-5 h-5 rounded-full transition-transform"
              style={{ backgroundColor: c, transform: newColor === c ? 'scale(1.3)' : undefined, outline: newColor === c ? `2px solid ${c}` : undefined, outlineOffset: '2px' }}
            />
          ))}
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      {/* List */}
      <div className="flex flex-wrap gap-3">
        {tags.map(tag => (
          <div key={tag.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full border-2 text-sm font-medium" style={{ borderColor: tag.color, color: tag.color, backgroundColor: tag.color + '15' }}>
            {editId === tag.id ? (
              <>
                <input value={editName} onChange={e => setEditName(e.target.value)} className="w-24 bg-transparent border-b border-current text-xs focus:outline-none" />
                <div className="flex gap-1">
                  {TAG_COLORS.map(c => (
                    <button key={c} onClick={() => setEditColor(c)} className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: c, outline: editColor === c ? `2px solid ${c}` : undefined, outlineOffset: '1px' }} />
                  ))}
                </div>
                <button onClick={saveEdit}><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setEditId(null)}><X className="w-3.5 h-3.5" /></button>
              </>
            ) : (
              <>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: tag.color, display: 'inline-block' }} />
                {tag.name}
                <button onClick={() => startEdit(tag)}><Edit2 className="w-3 h-3 opacity-60 hover:opacity-100" /></button>
                <button onClick={() => handleDelete(tag.id)}><X className="w-3 h-3 opacity-60 hover:opacity-100" /></button>
              </>
            )}
          </div>
        ))}
        {tags.length === 0 && <p className="text-sm text-gray-400">No tags yet. Create your first tag above.</p>}
      </div>
    </div>
  );
}

// ─────────────────── Attributes Section ───────────────────
function AttributesSection() {
  const [attrs, setAttrs] = useState<Attribute[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ key: '', label: '', type: 'TEXT', options: '', isRequired: false });
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    attributesApi.list().then(r => setAttrs(r.data));
  }, []);

  const handleSubmit = async () => {
    const payload = {
      key: form.key, label: form.label, type: form.type,
      options: form.type === 'DROPDOWN' ? form.options.split(',').map(o => o.trim()).filter(Boolean) : [],
      isRequired: form.isRequired,
    };
    if (editId) {
      const r = await attributesApi.update(editId, payload);
      setAttrs(prev => prev.map(a => a.id === editId ? r.data : a));
    } else {
      const r = await attributesApi.create(payload);
      setAttrs(prev => [...prev, r.data]);
    }
    setForm({ key: '', label: '', type: 'TEXT', options: '', isRequired: false });
    setShowForm(false);
    setEditId(null);
  };

  const startEdit = (a: Attribute) => {
    setForm({ key: a.key, label: a.label, type: a.type, options: a.options.join(', '), isRequired: a.isRequired });
    setEditId(a.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await attributesApi.delete(id);
    setAttrs(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Contact Attributes</h2>
          <p className="text-sm text-gray-500 mt-1">Define custom fields to capture CRM data for your contacts.</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ key: '', label: '', type: 'TEXT', options: '', isRequired: false }); }}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          <Plus className="w-4 h-4" /> Add Attribute
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
              <input value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                placeholder="e.g. Company Name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Key (auto-generated)</label>
              <input value={form.key} onChange={e => setForm(p => ({ ...p, key: e.target.value }))}
                placeholder="e.g. company_name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                {ATTR_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            {form.type === 'DROPDOWN' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Options (comma-separated)</label>
                <input value={form.options} onChange={e => setForm(p => ({ ...p, options: e.target.value }))}
                  placeholder="Option A, Option B, Option C" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isRequired} onChange={e => setForm(p => ({ ...p, isRequired: e.target.checked }))} className="rounded" />
            <span className="text-sm text-gray-700">Required field</span>
          </label>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
              {editId ? 'Update' : 'Create'} Attribute
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
        {attrs.map(a => (
          <div key={a.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{a.label}</p>
                <p className="text-xs text-gray-400 font-mono">{a.key}</p>
              </div>
              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{a.type}</span>
              {a.isRequired && <span className="px-2 py-0.5 bg-red-50 text-red-600 text-xs rounded-full">Required</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => startEdit(a)} className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>
              <button onClick={() => handleDelete(a.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        {attrs.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">No attributes yet.</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────── Welcome Message ───────────────────
function WelcomeSection({ settings, reload }: { settings: ManageSettings; reload: () => void }) {
  const [enabled, setEnabled] = useState(settings.welcomeEnabled ?? false);
  const [msg, setMsg] = useState(settings.welcomeMessage ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setEnabled(settings.welcomeEnabled ?? false); setMsg(settings.welcomeMessage ?? ''); }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await manageSettingsApi.updateWelcome({ welcomeEnabled: enabled, welcomeMessage: msg });
      toast.success('Welcome message saved');
      reload();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save welcome message';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Welcome Message</h2>
        <p className="text-sm text-gray-500 mt-1">Send an automatic greeting when a new contact messages you for the first time.</p>
      </div>
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div>
          <p className="text-sm font-medium text-gray-900">Enable Welcome Message</p>
          <p className="text-xs text-gray-500 mt-0.5">Triggered on first contact message</p>
        </div>
        <button onClick={() => setEnabled(!enabled)} className="text-teal-600">
          {enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-gray-400" />}
        </button>
      </div>
      {enabled && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Message</label>
          <textarea
            value={msg}
            onChange={e => setMsg(e.target.value)}
            rows={4}
            placeholder="Hi! Thanks for reaching out. We'll get back to you shortly."
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
          />
        </div>
      )}
      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

// ─────────────────── Off-Hours ───────────────────
const DEFAULT_SCHEDULE = Object.fromEntries(DAYS.map(d => [d, { enabled: d !== 'saturday' && d !== 'sunday', start: '09:00', end: '18:00' }]));

function OffHoursSection({ settings, reload }: { settings: ManageSettings; reload: () => void }) {
  const [enabled, setEnabled] = useState(settings.offHoursEnabled ?? false);
  const [msg, setMsg] = useState(settings.offHoursMessage ?? '');
  const [schedule, setSchedule] = useState<Record<string, { enabled: boolean; start: string; end: string }>>(
    (settings.offHoursSchedule as Record<string, { enabled: boolean; start: string; end: string }>) ?? DEFAULT_SCHEDULE
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(settings.offHoursEnabled ?? false);
    setMsg(settings.offHoursMessage ?? '');
    setSchedule((settings.offHoursSchedule as Record<string, { enabled: boolean; start: string; end: string }>) ?? DEFAULT_SCHEDULE);
  }, [settings]);

  const save = async () => {
    setSaving(true);
    await manageSettingsApi.updateOffHours({ offHoursEnabled: enabled, offHoursMessage: msg, offHoursSchedule: schedule });
    setSaving(false);
    reload();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Off-Hours Message</h2>
        <p className="text-sm text-gray-500 mt-1">Auto-reply when messages arrive outside business hours.</p>
      </div>
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
        <p className="text-sm font-medium text-gray-900">Enable Off-Hours Auto-Reply</p>
        <button onClick={() => setEnabled(!enabled)} className="text-teal-600">
          {enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-gray-400" />}
        </button>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Business Hours</p>
        <div className="space-y-2">
          {DAYS.map(day => (
            <div key={day} className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0">
              <input type="checkbox" checked={schedule[day]?.enabled ?? false}
                onChange={e => setSchedule(p => ({ ...p, [day]: { ...p[day], enabled: e.target.checked } }))}
                className="rounded text-teal-600" />
              <span className="w-24 text-sm text-gray-700 capitalize">{day}</span>
              {schedule[day]?.enabled && (
                <>
                  <input type="time" value={schedule[day]?.start ?? '09:00'}
                    onChange={e => setSchedule(p => ({ ...p, [day]: { ...p[day], start: e.target.value } }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <span className="text-gray-400 text-sm">to</span>
                  <input type="time" value={schedule[day]?.end ?? '18:00'}
                    onChange={e => setSchedule(p => ({ ...p, [day]: { ...p[day], end: e.target.value } }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </>
              )}
              {!schedule[day]?.enabled && <span className="text-sm text-gray-400">Closed</span>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Off-Hours Message</label>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3}
          placeholder="We're currently outside business hours. We'll reply within 24 hours."
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
      </div>

      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

// ─────────────────── Opt-In / Opt-Out ───────────────────
function OptInOutSection({ settings, reload }: { settings: ManageSettings; reload: () => void }) {
  const [optOut, setOptOut] = useState((settings.optOutKeywords ?? ['STOP', 'UNSUBSCRIBE']).join(', '));
  const [optIn, setOptIn] = useState((settings.optInKeywords ?? ['START', 'SUBSCRIBE']).join(', '));
  const [optOutReply, setOptOutReply] = useState(settings.optOutReply ?? '');
  const [optInReply, setOptInReply] = useState(settings.optInReply ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOptOut((settings.optOutKeywords ?? ['STOP', 'UNSUBSCRIBE']).join(', '));
    setOptIn((settings.optInKeywords ?? ['START', 'SUBSCRIBE']).join(', '));
    setOptOutReply(settings.optOutReply ?? '');
    setOptInReply(settings.optInReply ?? '');
  }, [settings]);

  const save = async () => {
    setSaving(true);
    await manageSettingsApi.updateOptInOut({
      optOutKeywords: optOut.split(',').map(k => k.trim().toUpperCase()).filter(Boolean),
      optInKeywords: optIn.split(',').map(k => k.trim().toUpperCase()).filter(Boolean),
      optOutReply,
      optInReply,
    });
    setSaving(false);
    reload();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Opt-In / Opt-Out</h2>
        <p className="text-sm text-gray-500 mt-1">Manage compliance keywords and automatic replies.</p>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
          <p className="text-sm font-semibold text-red-700">Opt-Out Settings</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Keywords (comma-separated)</label>
            <input value={optOut} onChange={e => setOptOut(e.target.value)}
              placeholder="STOP, UNSUBSCRIBE, QUIT"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Auto-reply message</label>
            <textarea value={optOutReply} onChange={e => setOptOutReply(e.target.value)} rows={2}
              placeholder="You have been unsubscribed. Reply START to opt back in."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
          </div>
        </div>
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-3">
          <p className="text-sm font-semibold text-green-700">Opt-In Settings</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Keywords (comma-separated)</label>
            <input value={optIn} onChange={e => setOptIn(e.target.value)}
              placeholder="START, SUBSCRIBE, YES"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Auto-reply message</label>
            <textarea value={optInReply} onChange={e => setOptInReply(e.target.value)} rows={2}
              placeholder="Welcome back! You have been re-subscribed."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 resize-none" />
          </div>
        </div>
      </div>
      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

// ─────────────────── Webhooks Section ───────────────────
function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', secret: '', events: [] as string[], headers: [] as { key: string; value: string }[] });
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; status?: number }>>({});

  useEffect(() => { webhooksApi.list().then(r => setWebhooks(r.data)); }, []);

  const toggleEvent = (e: string) => setForm(p => ({
    ...p,
    events: p.events.includes(e) ? p.events.filter(x => x !== e) : [...p.events, e],
  }));

  const addHeader = () => setForm(p => ({ ...p, headers: [...p.headers, { key: '', value: '' }] }));
  const removeHeader = (i: number) => setForm(p => ({ ...p, headers: p.headers.filter((_, idx) => idx !== i) }));
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setForm(p => ({ ...p, headers: p.headers.map((h, idx) => idx === i ? { ...h, [field]: val } : h) }));

  const handleCreate = async () => {
    if (!form.name || !form.url) return;
    const customHeaders = form.headers.filter(h => h.key && h.value).reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {});
    const r = await webhooksApi.create({
      name: form.name, url: form.url, events: form.events,
      secret: form.secret || undefined,
      ...(Object.keys(customHeaders).length > 0 ? { headers: customHeaders } : {}),
    });
    setWebhooks(prev => [...prev, r.data]);
    setForm({ name: '', url: '', secret: '', events: [], headers: [] });
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await webhooksApi.delete(id);
    setWebhooks(prev => prev.filter(w => w.id !== id));
  };

  const handleToggle = async (wh: WebhookItem) => {
    const r = await webhooksApi.update(wh.id, { isActive: !wh.isActive });
    setWebhooks(prev => prev.map(w => w.id === wh.id ? r.data : w));
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    const r = await webhooksApi.test(id);
    setTestResult(p => ({ ...p, [id]: r.data }));
    setTesting(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Webhooks</h2>
          <p className="text-sm text-gray-500 mt-1">Receive real-time event notifications via HTTP POST.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          <Plus className="w-4 h-4" /> Add Webhook
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="My Webhook" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
              <input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                placeholder="https://your-server.com/webhook" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Secret (optional)</label>
            <input value={form.secret} onChange={e => setForm(p => ({ ...p, secret: e.target.value }))}
              placeholder="Signing secret for X-Webhook-Secret header" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Custom Headers <span className="text-gray-400 font-normal">(e.g. Authorization for Airtable)</span></label>
              <button onClick={addHeader} className="text-xs text-teal-600 hover:text-teal-700 font-medium">+ Add header</button>
            </div>
            {form.headers.map((h, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={h.key} onChange={e => updateHeader(i, 'key', e.target.value)}
                  placeholder="Header name" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <input value={h.value} onChange={e => updateHeader(i, 'value', e.target.value)}
                  placeholder="Value" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <button onClick={() => removeHeader(i)} className="text-gray-400 hover:text-red-500 px-1"><X size={14} /></button>
              </div>
            ))}
            {form.headers.length === 0 && (
              <p className="text-xs text-gray-400">No custom headers. Add one for Airtable: <code className="bg-gray-100 px-1 rounded">Authorization</code> → <code className="bg-gray-100 px-1 rounded">Bearer your_api_key</code></p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Events</label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map(e => (
                <button key={e} onClick={() => toggleEvent(e)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${form.events.includes(e) ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">Create Webhook</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {webhooks.map(wh => (
          <div key={wh.id} className="p-4 bg-white border border-gray-200 rounded-xl">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 text-sm">{wh.name}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${wh.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {wh.isActive ? 'Active' : 'Paused'}
                  </span>
                  {wh.failureCount > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">{wh.failureCount} failures</span>}
                </div>
                <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{wh.url}</p>
                {wh.events.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {wh.events.map(e => <span key={e} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">{e}</span>)}
                  </div>
                )}
                {testResult[wh.id] && (
                  <p className={`text-xs mt-1 ${testResult[wh.id].success ? 'text-green-600' : 'text-red-500'}`}>
                    {testResult[wh.id].success ? `Test passed (${testResult[wh.id].status})` : 'Test failed — check URL'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                <button onClick={() => handleTest(wh.id)} disabled={testing === wh.id}
                  className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg text-xs flex items-center gap-1">
                  {testing === wh.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => handleToggle(wh)} className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg">
                  {wh.isActive ? <ToggleRight className="w-5 h-5 text-teal-600" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={() => handleDelete(wh.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {webhooks.length === 0 && <p className="text-center py-8 text-sm text-gray-400">No webhooks yet.</p>}
      </div>
    </div>
  );
}

// ─────────────────── Widget Section ───────────────────
function WidgetSection({ settings, reload }: { settings: ManageSettings; reload: () => void }) {
  const [enabled, setEnabled] = useState(settings.widgetEnabled ?? false);
  const [config, setConfig] = useState<{ color: string; greeting: string; position: string }>({
    color: '#0d9488',
    greeting: 'Chat with us on WhatsApp!',
    position: 'bottom-right',
    ...(settings.widgetConfig ?? {}),
  });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnabled(settings.widgetEnabled ?? false);
    setConfig(p => ({ ...p, ...(settings.widgetConfig ?? {}) }));
  }, [settings]);

  const save = async () => {
    setSaving(true);
    await manageSettingsApi.updateWidget({ widgetEnabled: enabled, widgetConfig: config });
    setSaving(false);
    reload();
  };

  const embedCode = `<script>
  window.WAPP_WIDGET = {
    color: "${config.color}",
    greeting: "${config.greeting}",
    position: "${config.position}"
  };
</script>
<script src="https://cdn.yourplatform.com/widget.js" async></script>`;

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Website Widget</h2>
        <p className="text-sm text-gray-500 mt-1">Add a WhatsApp chat button to your website.</p>
      </div>
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
        <p className="text-sm font-medium text-gray-900">Enable Website Widget</p>
        <button onClick={() => setEnabled(!enabled)} className="text-teal-600">
          {enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-gray-400" />}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Brand Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={config.color} onChange={e => setConfig(p => ({ ...p, color: e.target.value }))} className="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
            <input value={config.color} onChange={e => setConfig(p => ({ ...p, color: e.target.value }))} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Position</label>
          <select value={config.position} onChange={e => setConfig(p => ({ ...p, position: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="bottom-right">Bottom Right</option>
            <option value="bottom-left">Bottom Left</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Greeting Message</label>
        <input value={config.greeting} onChange={e => setConfig(p => ({ ...p, greeting: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Embed Code</label>
          <button onClick={copyEmbed} className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{embedCode}</pre>
      </div>
      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

// ─────────────────── QR Code Section ───────────────────
function QrCodeSection() {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('Hello! I want to learn more about your services.');
  const [generated, setGenerated] = useState(false);

  const waUrl = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(waUrl)}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">WhatsApp QR Code</h2>
        <p className="text-sm text-gray-500 mt-1">Generate a QR code that opens WhatsApp with a pre-filled message.</p>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (with country code)</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1234567890"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Pre-filled Message (optional)</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
        </div>
        <button onClick={() => setGenerated(true)} disabled={!phone}
          className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
          Generate QR Code
        </button>
      </div>
      {generated && phone && (
        <div className="flex flex-col items-center gap-4 p-6 bg-gray-50 rounded-xl border border-gray-200">
          <img src={qrApiUrl} alt="WhatsApp QR Code" className="w-48 h-48" />
          <p className="text-xs text-gray-500 font-mono break-all text-center max-w-xs">{waUrl}</p>
          <a href={qrApiUrl} download="whatsapp-qr.png"
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
            Download PNG
          </a>
        </div>
      )}
    </div>
  );
}

// ─────────────────── Main Page ───────────────────
export default function ManagePage() {
  const searchParams = useSearchParams();
  const [active, setActive] = useState(() => searchParams.get('tab') ?? 'members');
  const [settings, setSettings] = useState<ManageSettings>({});

  const loadSettings = useCallback(() => {
    manageSettingsApi.get().then(r => setSettings(r.data ?? {})).catch(() => {});
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const renderContent = () => {
    switch (active) {
      case 'members': return <TeamManagement />;
      case 'canned': return <CannedResponsesSection />;
      case 'teams': return <TeamsSection />;
      case 'tags': return <TagsSection />;
      case 'attributes': return <AttributesSection />;
      case 'welcome': return <WelcomeSection settings={settings} reload={loadSettings} />;
      case 'offhours': return <OffHoursSection settings={settings} reload={loadSettings} />;
      case 'optinout': return <OptInOutSection settings={settings} reload={loadSettings} />;
      case 'webhooks': return <WebhooksSection />;
      case 'widget': return <WidgetSection settings={settings} reload={loadSettings} />;
      case 'qrcode': return <QrCodeSection />;
      default: return null;
    }
  };

  return (
    <div className="flex h-full bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex-shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100">
          <h1 className="text-base font-bold text-gray-900">Manage</h1>
          <p className="text-xs text-gray-400 mt-0.5">Operational controls</p>
        </div>
        <nav className="p-2 space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn('w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active === s.id ? 'bg-teal-50 text-teal-700' : 'text-gray-600 hover:bg-gray-50')}
            >
              <s.icon className={`w-4 h-4 flex-shrink-0 ${active === s.id ? 'text-teal-600' : 'text-gray-400'}`} />
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
