'use client';
import { create } from 'zustand';
import { notificationsApi } from '@/lib/api';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  panelOpen: boolean;

  fetchAll: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  addNotification: (n: AppNotification) => void;
  setPanelOpen: (v: boolean) => void;
}

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  panelOpen: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const res = await notificationsApi.list();
      set({ notifications: res.data as AppNotification[] });
    } finally {
      set({ loading: false });
    }
  },

  fetchUnreadCount: async () => {
    try {
      const res = await notificationsApi.unreadCount();
      set({ unreadCount: (res.data as { count: number }).count });
    } catch { /* silent */ }
  },

  markRead: async (id: string) => {
    await notificationsApi.markRead(id);
    set((s) => ({
      notifications: s.notifications.map((n) => n.id === id ? { ...n, isRead: true } : n),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
  },

  markAllRead: async () => {
    await notificationsApi.markAllRead();
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },

  addNotification: (n: AppNotification) => {
    set((s) => ({
      notifications: [n, ...s.notifications].slice(0, 50),
      unreadCount: s.unreadCount + 1,
    }));
  },

  setPanelOpen: (v) => {
    set({ panelOpen: v });
    if (v && get().notifications.length === 0) void get().fetchAll();
  },
}));
