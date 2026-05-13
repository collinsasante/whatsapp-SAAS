'use client';
import { useCallback, useEffect, useState } from 'react';
import { X, Search, Check, Send, Images, Play, FileText, Music, ChevronLeft, ChevronRight } from 'lucide-react';
import { mediaApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface MediaItem {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
  mediaUrl: string;
  mediaType: string | null;
  mediaCaption: string | null;
  mediaSize: number | null;
  createdAt: string;
  contact: { id: string; name: string | null; phone: string };
}

type Tab = 'ALL' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

interface Props {
  onClose: () => void;
  onSend: (items: MediaItem[]) => Promise<void>;
}

const PAGE_SIZE = 40;

function thumbBg(type: string) {
  if (type === 'VIDEO') return 'bg-purple-50';
  if (type === 'AUDIO') return 'bg-blue-50';
  return 'bg-orange-50';
}
function fileIcon(type: string) {
  if (type === 'VIDEO') return <Play size={20} className="text-purple-400" />;
  if (type === 'AUDIO') return <Music size={20} className="text-blue-400" />;
  return <FileText size={20} className="text-orange-400" />;
}
function formatBytes(b: number | null) {
  if (!b) return '';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LibraryPickerModal({ onClose, onSend }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    const t = setTimeout(() => { setPage(1); void load(1, tab, search); }, 300);
    return () => clearTimeout(t);
  }, [search, tab, load]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  };

  const handleSend = async () => {
    const toSend = items.filter(i => selected.has(i.id));
    if (!toSend.length) return;
    setSending(true);
    try { await onSend(toSend); onClose(); }
    finally { setSending(false); }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const tabs: Tab[] = ['ALL', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'];
  const tabLabels: Record<Tab, string> = { ALL: 'All', IMAGE: 'Images', VIDEO: 'Videos', AUDIO: 'Audio', DOCUMENT: 'Documents' };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 680, maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Images size={18} className="text-teal-600" />
            <h2 className="font-semibold text-gray-900">File Library</h2>
            {selected.size > 0 && (
              <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                {selected.size} selected
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by contact or caption…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="flex items-center gap-0.5">
            {tabs.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  tab === t ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100',
                )}
              >
                {tabLabels[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {loading ? (
            <div className="flex justify-center pt-12">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-teal-600" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-12 text-center">
              <Images size={36} className="text-gray-300 mb-3" />
              <p className="text-gray-400 text-sm">No media files found</p>
            </div>
          ) : (
            <>
              {/* Select all row */}
              <div className="flex items-center justify-between mb-3">
                <button onClick={selectAll} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                  {selected.size === items.length ? 'Deselect all' : `Select all (${items.length})`}
                </button>
                <span className="text-xs text-gray-400">{total} files</span>
              </div>

              {/* Images + Videos grid */}
              {items.some(i => i.type === 'IMAGE' || i.type === 'VIDEO') && (
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {items.filter(i => i.type === 'IMAGE' || i.type === 'VIDEO').map(item => (
                    <GridTile
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggle(item.id)}
                    />
                  ))}
                </div>
              )}

              {/* Audio + Documents list */}
              {items.some(i => i.type === 'AUDIO' || i.type === 'DOCUMENT') && (
                <div className="space-y-1">
                  {items.filter(i => i.type === 'AUDIO' || i.type === 'DOCUMENT').map(item => (
                    <ListTile
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggle(item.id)}
                    />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); void load(p, tab, search); }} disabled={page === 1}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                    <ChevronLeft size={13} />
                  </button>
                  <span className="text-xs text-gray-500">{page} / {totalPages}</span>
                  <button onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); void load(p, tab, search); }} disabled={page === totalPages}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                    <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50">
          <p className="text-sm text-gray-500">
            {selected.size === 0 ? 'Select files to send' : `${selected.size} file${selected.size > 1 ? 's' : ''} selected`}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { void handleSend(); }}
              disabled={selected.size === 0 || sending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? (
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
              ) : (
                <Send size={13} />
              )}
              Send {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GridTile({ item, selected, onToggle }: { item: MediaItem; selected: boolean; onToggle: () => void }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div
      onClick={onToggle}
      className={cn(
        'relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all',
        selected ? 'border-teal-500 ring-2 ring-teal-500/30' : 'border-transparent hover:border-gray-300',
      )}
    >
      {item.type === 'IMAGE' && !imgErr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.mediaUrl} alt="" className="w-full h-full object-cover bg-gray-100" onError={() => setImgErr(true)} />
      ) : (
        <div className={cn('w-full h-full flex items-center justify-center', thumbBg(item.type))}>
          {fileIcon(item.type)}
        </div>
      )}
      {item.type === 'VIDEO' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
            <Play size={12} className="text-white ml-0.5" />
          </div>
        </div>
      )}
      {/* Checkbox */}
      <div className={cn(
        'absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
        selected ? 'bg-teal-500 border-teal-500' : 'bg-white/80 border-gray-300',
      )}>
        {selected && <Check size={11} className="text-white" strokeWidth={3} />}
      </div>
    </div>
  );
}

function ListTile({ item, selected, onToggle }: { item: MediaItem; selected: boolean; onToggle: () => void }) {
  const name = item.contact.name ?? item.contact.phone;
  return (
    <div
      onClick={onToggle}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer border transition-all',
        selected ? 'bg-teal-50 border-teal-200' : 'bg-white border-gray-100 hover:bg-gray-50',
      )}
    >
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', thumbBg(item.type))}>
        {fileIcon(item.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{item.mediaCaption ?? item.type.toLowerCase()}</p>
        <p className="text-xs text-gray-400">{name}{item.mediaSize ? ` · ${formatBytes(item.mediaSize)}` : ''}</p>
      </div>
      <div className={cn(
        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
        selected ? 'bg-teal-500 border-teal-500' : 'bg-white border-gray-300',
      )}>
        {selected && <Check size={11} className="text-white" strokeWidth={3} />}
      </div>
    </div>
  );
}
