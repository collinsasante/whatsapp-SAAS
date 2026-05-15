'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Search, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cannedResponsesApi } from '@/lib/api';

export type CannedItem = {
  id: string;
  title: string;
  shortcut: string;
  content: string;
  categoryId?: string | null;
  category?: { id: string; name: string; color: string } | null;
  tags: string[];
  mediaUrl?: string | null;
  mediaType?: string | null;
  isFavorite: boolean;
  usageCount: number;
};

type CategoryItem = {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  _count: { cannedResponses: number };
};

export function applyVars(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

// Module-level cache so data persists across open/close cycles
let cache: {
  items: CannedItem[];
  categories: CategoryItem[];
  favorites: CannedItem[];
  recent: CannedItem[];
  ts: number;
} | null = null;
const CACHE_TTL = 30_000;

export function invalidateCannedCache() {
  cache = null;
}

export default function CannedPicker({
  query,
  vars,
  onSelect,
  onClose,
}: {
  query: string;
  vars: Record<string, string>;
  onSelect: (text: string, mediaUrl?: string, mediaType?: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CannedItem[]>(cache?.items ?? []);
  const [categories, setCategories] = useState<CategoryItem[]>(cache?.categories ?? []);
  const [favorites, setFavorites] = useState<CannedItem[]>(cache?.favorites ?? []);
  const [recent, setRecent] = useState<CannedItem[]>(cache?.recent ?? []);
  const [section, setSection] = useState<'all' | 'favorites' | 'recent' | string>('all');
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(!cache || Date.now() - cache.ts > CACHE_TTL);
  const listRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Load data (with cache)
  useEffect(() => {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      setItems(cache.items);
      setCategories(cache.categories);
      setFavorites(cache.favorites);
      setRecent(cache.recent);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      cannedResponsesApi.list(),
      cannedResponsesApi.listCategories(),
      cannedResponsesApi.getFavorites(),
      cannedResponsesApi.getRecent(),
    ])
      .then(([allRes, catRes, favRes, recRes]) => {
        if (cancelled) return;
        const newItems = (allRes.data as CannedItem[]) ?? [];
        const newCats = (catRes.data as CategoryItem[]) ?? [];
        const newFavs = (favRes.data as CannedItem[]) ?? [];
        const newRec = (recRes.data as CannedItem[]) ?? [];
        cache = { items: newItems, categories: newCats, favorites: newFavs, recent: newRec, ts: Date.now() };
        setItems(newItems);
        setCategories(newCats);
        setFavorites(newFavs);
        setRecent(newRec);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filtered items by section + query
  const filtered = useMemo(() => {
    let source: CannedItem[];
    if (section === 'favorites') source = favorites;
    else if (section === 'recent') source = recent;
    else if (section === 'all') source = items;
    else source = items.filter((i) => i.categoryId === section);

    if (!query) return source;
    const q = query.toLowerCase();
    return source.filter(
      (i) =>
        i.shortcut.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [items, favorites, recent, section, query]);

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIdx(0);
  }, [filtered]);

  // Scroll active item into view
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleSelect = useCallback(
    async (item: CannedItem) => {
      const resolved = applyVars(item.content, vars);
      onSelect(resolved, item.mediaUrl ?? undefined, item.mediaType ?? undefined);
      try {
        await cannedResponsesApi.trackUsage(item.id);
        // Update local recent list
        setRecent((prev) => {
          const withoutThis = prev.filter((r) => r.id !== item.id);
          return [item, ...withoutThis].slice(0, 10);
        });
        if (cache) {
          const withoutThis = cache.recent.filter((r) => r.id !== item.id);
          cache = { ...cache, recent: [item, ...withoutThis].slice(0, 10) };
        }
      } catch {
        /* noop */
      }
    },
    [vars, onSelect],
  );

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent, item: CannedItem) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        const res = await cannedResponsesApi.toggleFavorite(item.id);
        const { isFavorite } = res.data as { isFavorite: boolean };
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isFavorite } : i)));
        if (isFavorite) {
          setFavorites((prev) => [{ ...item, isFavorite: true }, ...prev]);
        } else {
          setFavorites((prev) => prev.filter((i) => i.id !== item.id));
        }
        if (cache) {
          const updatedItems = cache.items.map((i) => (i.id === item.id ? { ...i, isFavorite } : i));
          const updatedFavs = isFavorite
            ? [{ ...item, isFavorite: true }, ...cache.favorites]
            : cache.favorites.filter((i) => i.id !== item.id);
          cache = { ...cache, items: updatedItems, favorites: updatedFavs };
        }
      } catch {
        /* noop */
      }
    },
    [],
  );

  // Keyboard interception — capture phase to prevent parent input handlers
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        if (filtered.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          void handleSelect(filtered[activeIdx] ?? filtered[0]);
        }
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [filtered, activeIdx, onClose, handleSelect]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 440 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-2xl flex-shrink-0">
        <Search size={12} className="text-gray-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-gray-600 flex-1">Canned Responses</span>
        {query && (
          <span className="text-[10px] font-mono bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">/{query}</span>
        )}
        <span className="text-[10px] text-gray-400 hidden sm:block">↑↓ · Enter · Esc</span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-32 border-r border-gray-100 bg-gray-50/60 flex-shrink-0 overflow-y-auto py-1">
          <SidebarItem label="All" icon="📋" count={items.length} active={section === 'all'} onClick={() => setSection('all')} />
          {favorites.length > 0 && (
            <SidebarItem label="Favorites" icon="⭐" count={favorites.length} active={section === 'favorites'} onClick={() => setSection('favorites')} />
          )}
          {recent.length > 0 && (
            <SidebarItem label="Recent" icon="🕐" count={recent.length} active={section === 'recent'} onClick={() => setSection('recent')} />
          )}
          {categories.length > 0 && <div className="mx-2.5 my-1 border-t border-gray-200" />}
          {categories.map((cat) => (
            <SidebarItem
              key={cat.id}
              label={cat.name}
              count={cat._count.cannedResponses}
              color={cat.color}
              active={section === cat.id}
              onClick={() => setSection(cat.id)}
            />
          ))}
        </div>

        {/* Items list */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 text-gray-400 gap-1">
              <span className="text-xl">🔍</span>
              <span className="text-xs">{query ? `No results for "/${query}"` : 'No responses here'}</span>
            </div>
          ) : (
            filtered.map((item, i) => {
              const preview = applyVars(item.content, vars);
              const isActive = i === activeIdx;
              return (
                <button
                  key={item.id}
                  ref={isActive ? (activeItemRef as React.RefObject<HTMLButtonElement>) : undefined}
                  onClick={() => void handleSelect(item)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    'w-full flex items-start gap-2 px-3 py-2 text-left transition-colors border-b border-gray-50 last:border-0 group',
                    isActive ? 'bg-teal-50' : 'hover:bg-gray-50',
                  )}
                >
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-mono flex-shrink-0',
                          isActive ? 'bg-teal-200 text-teal-800' : 'bg-teal-100 text-teal-700',
                        )}
                      >
                        /{item.shortcut}
                      </code>
                      {item.title && (
                        <span className="text-xs font-medium text-gray-700 truncate max-w-[120px]">{item.title}</span>
                      )}
                      {item.category && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-white flex-shrink-0"
                          style={{ backgroundColor: item.category.color }}
                        >
                          {item.category.name}
                        </span>
                      )}
                      {item.mediaUrl && (
                        <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          📎
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{preview}</span>
                    {item.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {item.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="text-[9px] bg-gray-100 text-gray-400 px-1 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onMouseDown={(e) => { void handleToggleFavorite(e, item); }}
                    className={cn(
                      'flex-shrink-0 mt-0.5 transition-opacity p-0.5',
                      item.isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <Star
                      size={11}
                      className={item.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}
                    />
                  </button>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-3 py-1 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl flex-shrink-0">
        <span className="text-[10px] text-gray-400">
          {filtered.length} response{filtered.length !== 1 ? 's' : ''}
          {query && (
            <> · matching <span className="font-mono text-teal-600">/{query}</span></>
          )}
        </span>
      </div>
    </div>
  );
}

function SidebarItem({
  label,
  icon,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  icon?: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors rounded-md mx-0.5 text-xs',
        active ? 'bg-teal-100 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-100',
      )}
    >
      {icon ? (
        <span className="text-xs flex-shrink-0 leading-none">{icon}</span>
      ) : (
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color ?? '#6B7280' }} />
      )}
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            'text-[9px] rounded-full px-1 min-w-[16px] text-center flex-shrink-0',
            active ? 'bg-teal-200 text-teal-700' : 'bg-gray-200 text-gray-500',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
