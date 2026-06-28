import { create } from 'zustand';
import { mmkv } from '../lib/storage';

export interface QueuedMessage {
  id: string;
  conversationId: string;
  content: string;
  type: string;
  timestamp: number;
  retries: number;
}

const QUEUE_KEY = 'message_send_queue';
const MAX_RETRIES = 3;

function loadQueue(): QueuedMessage[] {
  try {
    const raw = mmkv.getString(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
  } catch {
    return [];
  }
}

function persist(queue: QueuedMessage[]) {
  mmkv.set(QUEUE_KEY, JSON.stringify(queue));
}

interface MessageQueueState {
  queue: QueuedMessage[];
  isProcessing: boolean;

  enqueue: (msg: Pick<QueuedMessage, 'conversationId' | 'content' | 'type'>) => QueuedMessage;
  dequeue: (id: string) => void;
  incrementRetry: (id: string) => void;
  pruneExhausted: () => void;
  setProcessing: (v: boolean) => void;
}

export const useMessageQueueStore = create<MessageQueueState>()((set, get) => ({
  queue: loadQueue(),
  isProcessing: false,

  enqueue: (msg) => {
    const item: QueuedMessage = {
      ...msg,
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      retries: 0,
    };
    const updated = [...get().queue, item];
    persist(updated);
    set({ queue: updated });
    return item;
  },

  dequeue: (id) => {
    const updated = get().queue.filter((m) => m.id !== id);
    persist(updated);
    set({ queue: updated });
  },

  incrementRetry: (id) => {
    const updated = get().queue.map((m) =>
      m.id === id ? { ...m, retries: m.retries + 1 } : m,
    );
    persist(updated);
    set({ queue: updated });
  },

  pruneExhausted: () => {
    const updated = get().queue.filter((m) => m.retries < MAX_RETRIES);
    persist(updated);
    set({ queue: updated });
  },

  setProcessing: (isProcessing) => set({ isProcessing }),
}));
