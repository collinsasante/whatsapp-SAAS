'use client';
import { RefreshCw } from 'lucide-react';

export function LiveBadge({
  secondsAgo,
  onRefresh,
  refreshing,
}: {
  secondsAgo: number;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const label = secondsAgo < 5 ? 'just now' : secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`;

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
        Updated {label}
      </span>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
        title="Refresh now"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
