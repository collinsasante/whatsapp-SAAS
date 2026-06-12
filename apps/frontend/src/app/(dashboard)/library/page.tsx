'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, X, Send, Download, Play, FileText, Music,
  ChevronLeft, ChevronRight, ZoomIn, Images, Trash2, Upload, User, Users, Layers,
} from 'lucide-react';
import { mediaApi, conversationsApi, messagesApi } from '@/lib/api';
import { showConfirm } from '@/store/confirm.store';
import { useInboxStore } from '@/store/inbox.store';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { formatRelativeTime, cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────
interface MediaItem {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
  mediaUrl: string;
  mediaType: string | null;
  mediaCaption: string | null;
  mediaSize: number | null;
  createdAt: string;
  direction: string;
  contact: { id: string; name: string | null; phone: string };
  conversation: { id: string };
  isAsset?: boolean;
}

interface AgentAsset {
  id: string;
  type: MediaItem['type'];
  fileUrl: string;
  mimeType: string | null;
  fileSize: number | null;
  originalName: string;
  createdAt: string;
  uploadedBy?: { name: string | null } | null;
}

interface ConvOption {
  id: string;
  status: string;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  lastMessageAt: string | null;
}

type Tab = 'ALL' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

const PAGE_SIZE = 48;

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string) {
  if (type === 'VIDEO') return <Play size={24} className="text-purple-400" />;
  if (type === 'AUDIO') return <Music size={24} className="text-blue-400" />;
  return <FileText size={24} className="text-orange-400" />;
}

function thumbBg(type: string) {
  if (type === 'VIDEO') return 'bg-purple-50';
  if (type === 'AUDIO') return 'bg-blue-50';
  return 'bg-orange-50';
}

const MIME_TO_TYPE: Record<string, MediaItem['type']> = {
  'image/jpeg': 'IMAGE', 'image/png': 'IMAGE', 'image/gif': 'IMAGE', 'image/webp': 'IMAGE',
  'video/mp4': 'VIDEO', 'video/webm': 'VIDEO',
  'audio/mpeg': 'AUDIO', 'audio/ogg': 'AUDIO', 'audio/wav': 'AUDIO',
};

const AVATAR_COLORS = ['bg-teal-100 text-teal-700', 'bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-orange-100 text-orange-700'];
function avatarColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; }
function initials(s: string) { return s.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function LibraryPage() {
  const router = useRouter();
  const { setActiveConversation, prependConversation } = useInboxStore();

  // Customer files — media from conversations
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Agent library — files uploaded by agents
  const [agentAssets, setAgentAssets] = useState<AgentAsset[]>([]);
  const [agentLoading, setAgentLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [deduplicating, setDeduplicating] = useState(false);
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');

  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const [sendTarget, setSendTarget] = useState<MediaItem | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);

  const loadAgentAssets = useCallback(async () => {
    setAgentLoading(true);
    try {
      const res = await mediaApi.assets({ limit: 5000 });
      setAgentAssets((res.data as { data: AgentAsset[] }).data ?? []);
    } finally { setAgentLoading(false); }
  }, []);

  const load = useCallback(async (pg: number, t: Tab, q: string) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page: pg, limit: PAGE_SIZE };
      if (t !== 'ALL') params.type = t;
      if (q) params.search = q;
      const res = await mediaApi.library(params);
      const data = res.data as { data: MediaItem[]; meta: { total: number } };
      setItems(data.data);
      setTotal(data.meta.total);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void loadAgentAssets();
  }, [loadAgentAssets]);

  // Auto-deduplicate every 15 minutes silently
  useEffect(() => {
    const run = async () => {
      try {
        const res = await mediaApi.deduplicate();
        const { removed } = res.data as { removed: number };
        if (removed > 0) void loadAgentAssets();
      } catch { /* silent */ }
    };
    const id = setInterval(run, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadAgentAssets]);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); void load(1, tab, search); }, 300);
    return () => clearTimeout(t);
  }, [search, tab, load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const goPage = (p: number) => { setPage(p); void load(p, tab, search); };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Check for duplicate name locally before upload
    const isDuplicate = agentAssets.some(
      (a) => a.originalName.toLowerCase() === file.name.toLowerCase(),
    );
    if (isDuplicate) {
      toast.error(`"${file.name}" already exists in the library. Rename the file or use the existing one.`);
      if (uploadRef.current) uploadRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const res = await mediaApi.upload(file);
      const asset = res.data as AgentAsset & { fileUrl: string };
      setAgentAssets((prev) => [asset, ...prev]);
      toast.success('File uploaded to Agent Library');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast.error(typeof msg === 'string' ? msg : 'Upload failed');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const handleDeduplicate = async () => {
    const ok = await showConfirm('Remove duplicate files?', {
      subtext: 'Keeps one copy (most recent) of each filename. Older duplicates will be permanently deleted.',
      confirmLabel: 'Clean Up',
      danger: false,
    });
    if (!ok) return;
    setDeduplicating(true);
    try {
      const res = await mediaApi.deduplicate();
      const { removed } = res.data as { removed: number };
      if (removed === 0) {
        toast.success('No duplicates found');
      } else {
        toast.success(`Removed ${removed} duplicate file${removed !== 1 ? 's' : ''}`);
        void loadAgentAssets();
      }
    } catch { toast.error('Failed to clean duplicates'); }
    finally { setDeduplicating(false); }
  };

  const handleDelete = async (asset: AgentAsset) => {
    if (!await showConfirm(`Remove "${asset.originalName}" from the library?`)) return;
    try {
      await mediaApi.deleteAsset(asset.id);
      setAgentAssets((prev) => prev.filter((a) => a.id !== asset.id));
      toast.success('File removed');
    } catch { toast.error('Failed to delete'); }
  };

  const handleDeleteAssetById = (item: MediaItem) => {
    const asset = agentAssets.find(a => a.id === item.id);
    if (asset) void handleDelete(asset);
  };

  const assetToMediaItem = (a: AgentAsset): MediaItem => ({
    id: a.id,
    type: a.type,
    mediaUrl: a.fileUrl,
    mediaType: a.mimeType,
    mediaCaption: a.originalName,
    mediaSize: a.fileSize,
    createdAt: a.createdAt,
    direction: 'OUTBOUND',
    contact: { id: '', name: a.uploadedBy?.name ?? 'Agent', phone: '' },
    conversation: { id: '' },
    isAsset: true,
  });

  const filteredAgentAssets = agentAssets.filter(a =>
    (tab === 'ALL' || a.type === tab) &&
    (!search || a.originalName.toLowerCase().includes(search.toLowerCase())),
  );
  const filteredItems = items.filter(i => tab === 'ALL' || i.type === tab);

  const handleSend = async (item: MediaItem, conversationId: string) => {
    try {
      await messagesApi.send(conversationId, {
        type: item.type,
        mediaUrl: item.mediaUrl,
        mediaCaption: item.mediaCaption ?? undefined,
        mediaType: item.mediaType ?? undefined,
      });
      toast.success('Sent!');
      setSendTarget(null);
    } catch { toast.error('Failed to send'); }
  };

  const handleSendToConversation = async (item: MediaItem, conv: ConvOption) => {
    await handleSend(item, conv.id);
    prependConversation(conv as never);
    setActiveConversation(conv.id);
    router.push('/inbox');
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'IMAGE', label: 'Images' },
    { key: 'VIDEO', label: 'Videos' },
    { key: 'AUDIO', label: 'Audio' },
    { key: 'DOCUMENT', label: 'Documents' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
              <Images size={18} className="text-teal-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">File Library</h1>
              <p className="text-sm text-gray-500 mt-0.5">{(agentAssets.length + total).toLocaleString()} media files</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by contact or caption…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50"
              />
            </div>
            <input ref={uploadRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.csv" className="hidden" onChange={(e) => { void handleUpload(e); }} />
            <button
              onClick={() => { void handleDeduplicate(); }}
              disabled={deduplicating}
              title="Remove duplicate files"
              className="flex items-center gap-2 px-3 py-2 text-gray-500 text-sm font-medium rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              <Layers size={15} />
              {deduplicating ? 'Cleaning…' : 'Clean Duplicates'}
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors"
            >
              <Upload size={15} />
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                tab === t.key ? 'bg-teal-600 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">

        {/* Agent Library */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 bg-teal-50 rounded-lg flex items-center justify-center">
              <User size={13} className="text-teal-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700">Agent Library</h2>
            <span className="text-xs text-gray-400">· Files uploaded by agents</span>
          </div>
          {agentLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
            </div>
          ) : filteredAgentAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 bg-white rounded-xl border border-dashed border-gray-200">
              <User size={24} className="text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No agent files{search ? ' matching your search' : ' yet'}</p>
              {!search && (
                <button
                  onClick={() => uploadRef.current?.click()}
                  className="mt-3 text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                  Upload a file
                </button>
              )}
            </div>
          ) : (
            <>
              {(tab === 'ALL' || tab === 'IMAGE' || tab === 'VIDEO') && (
                <MediaGrid
                  items={filteredAgentAssets.map(assetToMediaItem).filter(i => i.type === 'IMAGE' || i.type === 'VIDEO')}
                  onPreview={setLightbox}
                  onSend={setSendTarget}
                  onDelete={handleDeleteAssetById}
                  showSection={tab === 'ALL'}
                />
              )}
              {(tab === 'ALL' || tab === 'AUDIO') && (
                <MediaList
                  items={filteredAgentAssets.map(assetToMediaItem).filter(i => i.type === 'AUDIO')}
                  onSend={setSendTarget}
                  onDelete={handleDeleteAssetById}
                  title={tab === 'ALL' ? 'Audio' : undefined}
                />
              )}
              {(tab === 'ALL' || tab === 'DOCUMENT') && (
                <MediaList
                  items={filteredAgentAssets.map(assetToMediaItem).filter(i => i.type === 'DOCUMENT')}
                  onSend={setSendTarget}
                  onDelete={handleDeleteAssetById}
                  title={tab === 'ALL' ? 'Documents' : undefined}
                />
              )}
            </>
          )}
        </div>

        {/* Customer Files */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 bg-blue-50 rounded-lg flex items-center justify-center">
              <Users size={13} className="text-blue-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700">Customer Files</h2>
            <span className="text-xs text-gray-400">· Media shared in conversations</span>
          </div>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 bg-white rounded-xl border border-dashed border-gray-200">
              <Users size={24} className="text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No customer files{search ? ' matching your search' : ' yet'}</p>
              {!search && <p className="text-xs text-gray-300 mt-1">Media shared in conversations will appear here</p>}
            </div>
          ) : (
            <>
              {(tab === 'ALL' || tab === 'IMAGE' || tab === 'VIDEO') && (
                <MediaGrid
                  items={filteredItems.filter(i => i.type === 'IMAGE' || i.type === 'VIDEO')}
                  onPreview={setLightbox}
                  onSend={setSendTarget}
                  showSection={tab === 'ALL'}
                />
              )}
              {(tab === 'ALL' || tab === 'AUDIO') && (
                <MediaList
                  items={filteredItems.filter(i => i.type === 'AUDIO')}
                  onSend={setSendTarget}
                  title={tab === 'ALL' ? 'Audio' : undefined}
                />
              )}
              {(tab === 'ALL' || tab === 'DOCUMENT') && (
                <MediaList
                  items={filteredItems.filter(i => i.type === 'DOCUMENT')}
                  onSend={setSendTarget}
                  title={tab === 'ALL' ? 'Documents' : undefined}
                />
              )}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 px-1">
                  <p className="text-sm text-gray-500">
                    Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => goPage(Math.max(1, page - 1))} disabled={page === 1}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const p = page <= 3 ? i + 1 : page + i - 2;
                      if (p < 1 || p > totalPages) return null;
                      return (
                        <button key={p} onClick={() => goPage(p)}
                          className={cn('w-8 h-8 flex items-center justify-center rounded-lg text-sm', p === page ? 'bg-teal-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50')}>
                          {p}
                        </button>
                      );
                    })}
                    <button onClick={() => goPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      </div>

      {lightbox && (
        <Lightbox
          item={lightbox}
          items={[...agentAssets.map(assetToMediaItem), ...items].filter(i => i.type === 'IMAGE' || i.type === 'VIDEO')}
          onClose={() => setLightbox(null)}
          onSend={() => { setSendTarget(lightbox); setLightbox(null); }}
          onNavigate={setLightbox}
        />
      )}

      {sendTarget && (
        <SendToModal
          item={sendTarget}
          onClose={() => setSendTarget(null)}
          onSend={handleSendToConversation}
        />
      )}
    </div>
  );
}

// ─── Media Grid ─────────────────────────────────────────────────────────────
function MediaGrid({
  items, onPreview, onSend, onDelete, showSection,
}: {
  items: MediaItem[];
  onPreview: (item: MediaItem) => void;
  onSend: (item: MediaItem) => void;
  onDelete?: (item: MediaItem) => void;
  showSection: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-8">
      {showSection && <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Images &amp; Videos</h2>}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
        {items.map((item) => (
          <MediaTile key={item.id} item={item} onPreview={onPreview} onSend={onSend} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function MediaTile({ item, onPreview, onSend, onDelete }: { item: MediaItem; onPreview: (i: MediaItem) => void; onSend: (i: MediaItem) => void; onDelete?: (i: MediaItem) => void }) {
  const [imgErr, setImgErr] = useState(false);
  const name = item.contact.name ?? item.contact.phone;

  return (
    <div className="group relative aspect-square rounded-xl overflow-hidden bg-gray-100 cursor-pointer border border-gray-200"
      onClick={() => onPreview(item)}>
      {item.type === 'IMAGE' && !imgErr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.mediaUrl} alt={item.mediaCaption ?? ''} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
      ) : (
        <div className={cn('w-full h-full flex items-center justify-center', thumbBg(item.type))}>
          {fileIcon(item.type)}
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex flex-col justify-between p-2 opacity-0 group-hover:opacity-100">
        <div className="flex justify-between">
          {onDelete ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(item); }}
              className="w-7 h-7 bg-red-500 rounded-lg flex items-center justify-center text-white hover:bg-red-600 transition-colors"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          ) : <span />}
          <button
            onClick={(e) => { e.stopPropagation(); onSend(item); }}
            className="w-7 h-7 bg-teal-600 rounded-lg flex items-center justify-center text-white hover:bg-teal-700 transition-colors"
            title="Send to chat"
          >
            <Send size={12} />
          </button>
        </div>
        <div>
          {item.type === 'IMAGE' && (
            <div className="flex items-center gap-1 text-white">
              <ZoomIn size={11} /><span className="text-xs">Preview</span>
            </div>
          )}
          <p className="text-white text-xs truncate mt-0.5">{name}</p>
        </div>
      </div>

      {item.type === 'VIDEO' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 bg-black/50 rounded-full flex items-center justify-center">
            <Play size={14} className="text-white ml-0.5" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Media List ─────────────────────────────────────────────────────────────
function MediaList({ items, onSend, onDelete, title }: { items: MediaItem[]; onSend: (i: MediaItem) => void; onDelete?: (i: MediaItem) => void; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-8">
      {title && <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</h2>}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        {items.map((item) => {
          const name = item.contact.name ?? item.contact.phone;
          const color = avatarColor(name);
          const filename = item.mediaCaption ?? item.mediaType ?? item.type.toLowerCase();
          return (
            <div key={item.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', thumbBg(item.type))}>
                {fileIcon(item.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{filename}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className={cn('w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0', color)} style={{ fontSize: 8 }}>
                    {initials(name)}
                  </div>
                  <span className="text-xs text-gray-400">{name}</span>
                  {item.contact.phone && item.contact.name && (
                    <><span className="text-xs text-gray-300">·</span><span className="text-xs text-gray-400 font-mono">{item.contact.phone}</span></>
                  )}
                  {item.mediaSize && <><span className="text-xs text-gray-300">·</span><span className="text-xs text-gray-400">{formatBytes(item.mediaSize)}</span></>}
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-gray-400">{formatRelativeTime(item.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <a
                  href={item.mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                  title="Open"
                >
                  <Download size={14} />
                </a>
                <button
                  onClick={() => onSend(item)}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                  title="Send to chat"
                >
                  <Send size={14} />
                </button>
                {onDelete && (
                  <button
                    onClick={() => onDelete(item)}
                    className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Lightbox ──────────────────────────────────────────────────────────────
function Lightbox({ item, items, onClose, onSend, onNavigate }: { item: MediaItem; items: MediaItem[]; onClose: () => void; onSend: () => void; onNavigate: (item: MediaItem) => void }) {
  const idx = items.findIndex(i => i.id === item.id);
  const prev = idx > 0 ? items[idx - 1] : null;
  const next = idx < items.length - 1 ? items[idx + 1] : null;
  const name = item.contact.name ?? item.contact.phone;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
      if (e.key === 'ArrowRight' && next) onNavigate(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onNavigate, prev, next]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-white font-medium">{name}</p>
          {item.mediaCaption && <p className="text-gray-400 text-sm mt-0.5">{item.mediaCaption}</p>}
          <p className="text-gray-500 text-xs mt-0.5">{formatRelativeTime(item.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onSend} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm rounded-xl hover:bg-teal-700 transition-colors">
            <Send size={14} /> Send to Chat
          </button>
          <a href={item.mediaUrl} target="_blank" rel="noopener noreferrer" className="w-9 h-9 flex items-center justify-center bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors">
            <Download size={16} />
          </a>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-16 py-4 relative min-h-0" onClick={(e) => e.stopPropagation()}>
        {prev && (
          <button onClick={() => onNavigate(prev)} className="absolute left-4 w-10 h-10 bg-white/10 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-colors z-10">
            <ChevronLeft size={20} />
          </button>
        )}
        {item.type === 'IMAGE' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.mediaUrl} alt={item.mediaCaption ?? ''} className="max-w-full max-h-full object-contain rounded-lg select-none" />
        ) : item.type === 'VIDEO' ? (
          <video src={item.mediaUrl} controls autoPlay className="max-w-full max-h-full rounded-lg" />
        ) : null}
        {next && (
          <button onClick={() => onNavigate(next)} className="absolute right-4 w-10 h-10 bg-white/10 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-colors z-10">
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      {items.length > 1 && (
        <div className="text-center pb-4 flex-shrink-0">
          <span className="text-gray-400 text-sm">{idx + 1} / {items.length}</span>
        </div>
      )}
    </div>
  );
}

// ─── Send To Modal ──────────────────────────────────────────────────────────
function SendToModal({ item, onClose, onSend }: { item: MediaItem; onClose: () => void; onSend: (item: MediaItem, conv: ConvOption) => void }) {
  const [search, setSearch] = useState('');
  const [convs, setConvs] = useState<ConvOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await conversationsApi.list({ search: search || undefined, limit: 20, status: 'OPEN' });
        setConvs((res.data as { data: ConvOption[] }).data);
      } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const handleSend = async (conv: ConvOption) => {
    setSending(conv.id);
    try { await onSend(item, conv); }
    finally { setSending(null); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {item.type === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.mediaUrl} alt="" className="w-10 h-10 rounded-lg object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', thumbBg(item.type))}>
                {fileIcon(item.type)}
              </div>
            )}
            <div>
              <h3 className="font-semibold text-gray-900">Send to Chat</h3>
              <p className="text-xs text-gray-400">{item.mediaCaption ?? item.type.toLowerCase()}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input ref={inputRef} type="text" placeholder="Search conversations…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
          ) : convs.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No open conversations found</p>
          ) : convs.map((conv) => {
            const name = conv.contact.name ?? conv.contact.phone;
            const color = avatarColor(name);
            return (
              <button key={conv.id} onClick={() => { void handleSend(conv); }} disabled={!!sending}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left disabled:opacity-60">
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0', color)}>{initials(name)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                  <p className="text-xs text-gray-400 font-mono">{conv.contact.phone}</p>
                </div>
                {sending === conv.id ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-600" />
                ) : (
                  <Send size={13} className="text-teal-500 opacity-0 group-hover:opacity-100" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
