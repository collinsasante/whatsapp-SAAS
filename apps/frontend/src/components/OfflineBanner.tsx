'use client';
import { useEffect, useState } from 'react';
import { WifiOff, CheckCircle2, Loader2 } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineStore } from '@/store/offline.store';

export default function OfflineBanner() {
  const online = useNetworkStatus();
  const { queuedMessages, queuedDrafts, syncing, lastSyncedCount, setLastSyncedCount } = useOfflineStore();
  const [showSynced, setShowSynced] = useState(false);
  const total = queuedMessages + queuedDrafts;

  useEffect(() => {
    if (lastSyncedCount > 0) {
      setShowSynced(true);
      setLastSyncedCount(0);
      const t = setTimeout(() => setShowSynced(false), 4000);
      return () => clearTimeout(t);
    }
  }, [lastSyncedCount, setLastSyncedCount]);

  if (syncing) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-teal-600 text-white text-xs font-medium flex-shrink-0 z-50">
        <Loader2 size={13} className="animate-spin" />
        Syncing queued items…
      </div>
    );
  }

  if (showSynced && online) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-green-500 text-white text-xs font-medium flex-shrink-0 z-50">
        <CheckCircle2 size={13} />
        Back online &mdash; {total === 0 ? 'everything synced' : `${lastSyncedCount} item${lastSyncedCount !== 1 ? 's' : ''} synced`}
      </div>
    );
  }

  if (!online) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-gray-800 text-white text-xs font-medium flex-shrink-0 z-50">
        <WifiOff size={13} />
        You&apos;re offline{total > 0 ? ` — ${total} item${total !== 1 ? 's' : ''} queued` : ' — messages will be queued automatically'}
      </div>
    );
  }

  return null;
}
