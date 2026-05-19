'use client';
import { useEffect, useState, memo } from 'react';
import { ExternalLink } from 'lucide-react';

interface PreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const cache = new Map<string, PreviewData | null>();

async function fetchPreview(url: string): Promise<PreviewData | null> {
  if (cache.has(url)) return cache.get(url)!;
  try {
    const res = await fetch(`/api/v1/link-preview?url=${encodeURIComponent(url)}`, {
      credentials: 'include',
    });
    if (!res.ok) { cache.set(url, null); return null; }
    const data = await res.json() as PreviewData & { error?: string };
    if (data.error || (!data.title && !data.image)) { cache.set(url, null); return null; }
    cache.set(url, data);
    return data;
  } catch {
    cache.set(url, null);
    return null;
  }
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/);
  return match?.[0] ?? null;
}

export const LinkPreview = memo(function LinkPreview({ url, isOutbound }: { url: string; isOutbound: boolean }) {
  const [data, setData] = useState<PreviewData | null | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetchPreview(url).then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [url]);

  if (data === 'loading' || !data) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block mt-2 rounded-xl overflow-hidden border transition-opacity hover:opacity-90 ${
        isOutbound ? 'border-teal-700/40 bg-teal-700/20' : 'border-gray-200 bg-gray-50'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {data.image && (
        <img
          src={data.image}
          alt={data.title ?? ''}
          className="w-full h-32 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="px-3 py-2">
        {data.siteName && (
          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isOutbound ? 'text-teal-200' : 'text-teal-600'}`}>
            {data.siteName}
          </p>
        )}
        {data.title && (
          <p className={`text-xs font-semibold leading-snug line-clamp-2 ${isOutbound ? 'text-white' : 'text-gray-900'}`}>
            {data.title}
          </p>
        )}
        {data.description && (
          <p className={`text-[11px] mt-0.5 line-clamp-2 ${isOutbound ? 'text-teal-100' : 'text-gray-500'}`}>
            {data.description}
          </p>
        )}
        <div className={`flex items-center gap-1 mt-1 text-[10px] ${isOutbound ? 'text-teal-200' : 'text-gray-400'}`}>
          <ExternalLink size={10} />
          <span className="truncate">{new URL(url).hostname}</span>
        </div>
      </div>
    </a>
  );
});
