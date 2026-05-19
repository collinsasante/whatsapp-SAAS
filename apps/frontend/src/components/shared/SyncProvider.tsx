'use client';
import { useEffect, useRef } from 'react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineStore } from '@/store/offline.store';
import { offlineQueue } from '@/lib/offline-queue';
import { flushOfflineQueue } from '@/lib/sync-engine';

export function SyncProvider() {
  const online = useNetworkStatus();
  const { setQueuedCounts } = useOfflineStore();
  const wasOffline = useRef(false);

  // Hydrate queue counts from IDB on mount
  useEffect(() => {
    async function hydrate() {
      const [msgs, drafts] = await Promise.all([
        offlineQueue.getAllMessages(),
        offlineQueue.getAllDrafts(),
      ]);
      setQueuedCounts(msgs.length, drafts.length);
    }
    void hydrate();
  }, [setQueuedCounts]);

  // Flush when reconnecting
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      void flushOfflineQueue();
    }
  }, [online]);

  return null;
}
