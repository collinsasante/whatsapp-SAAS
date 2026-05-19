import { create } from 'zustand';

interface OfflineState {
  queuedMessages: number;
  queuedDrafts: number;
  syncing: boolean;
  lastSyncedCount: number;
  setQueuedCounts: (messages: number, drafts: number) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncedCount: (count: number) => void;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  queuedMessages: 0,
  queuedDrafts: 0,
  syncing: false,
  lastSyncedCount: 0,
  setQueuedCounts: (messages, drafts) => set({ queuedMessages: messages, queuedDrafts: drafts }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSyncedCount: (count) => set({ lastSyncedCount: count }),
}));
