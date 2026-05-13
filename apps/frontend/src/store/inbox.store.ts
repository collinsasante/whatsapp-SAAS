'use client';
import { create } from 'zustand';
import { Message } from '@whatsapp-platform/shared-types';

export interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  user?: { id: string; name: string } | null;
}

interface Conversation {
  id: string;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  labels: string[];
  messages?: Message[];
  channel?: { id: string; type: string; name: string };
  requestedAt?: string;
  intervenedAt?: string;
  resolvedAt?: string;
  slaDeadline?: string;
  priority?: number;
  reopenedCount?: number;
}

export interface StatusCounts {
  REQUESTED: number;
  INTERVENED: number;
  RESOLVED: number;
}

interface InboxState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  typingUsers: Record<string, string[]>;
  activityLogs: Record<string, ActivityEntry[]>;
  statusCounts: StatusCounts;
  setConversations: (conversations: Conversation[]) => void;
  prependConversation: (conversation: Conversation) => void;
  setActiveConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  updateConversation: (id: string, data: Partial<Conversation>) => void;
  updateMessageStatus: (conversationId: string, messageId: string, status: string) => void;
  updateMessage: (conversationId: string, messageId: string, data: Partial<Message>) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  removeConversation: (id: string) => void;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
  setActivityLogs: (conversationId: string, entries: ActivityEntry[]) => void;
  addActivityLog: (conversationId: string, entry: ActivityEntry) => void;
  setStatusCounts: (counts: StatusCounts) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  typingUsers: {},
  activityLogs: {},
  statusCounts: { REQUESTED: 0, INTERVENED: 0, RESOLVED: 0 },

  setConversations: (conversations) => set({ conversations }),

  prependConversation: (conversation) =>
    set((state) => ({ conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)] })),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      // Skip exact duplicate
      if (existing.some((m) => m.id === message.id)) return state;

      // Replace matching optimistic (temp-*) message with the real one
      const withoutOptimistic = existing.filter((m) => {
        if (!m.id.startsWith('temp-')) return true;
        // Same direction + same content + created less than 15s ago
        const tempTime = parseInt(m.id.replace('temp-', ''), 10);
        if (Date.now() - tempTime > 15_000) return true;
        return m.content !== message.content || m.direction !== message.direction;
      });

      return {
        messages: {
          ...state.messages,
          [conversationId]: [...withoutOptimistic, message],
        },
        conversations: state.conversations.map((c) =>
          c.id === conversationId
            ? { ...c, lastMessageAt: message.createdAt as unknown as string }
            : c,
        ),
      };
    }),

  setMessages: (conversationId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
    })),

  updateConversation: (id, data) =>
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, ...data } : c)),
    })),

  updateMessageStatus: (conversationId, messageId, status) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, status: status as Message['status'] } : m,
        ),
      },
    })),

  updateMessage: (conversationId, messageId, data) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, ...data } : m,
        ),
      },
    })),

  removeMessage: (conversationId, messageId) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).filter((m) => m.id !== messageId),
      },
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
    })),

  setTyping: (conversationId, userId, isTyping) =>
    set((state) => {
      const current = state.typingUsers[conversationId] ?? [];
      const updated = isTyping
        ? Array.from(new Set([...current, userId]))
        : current.filter((id) => id !== userId);
      return { typingUsers: { ...state.typingUsers, [conversationId]: updated } };
    }),

  setActivityLogs: (conversationId, entries) =>
    set((state) => ({
      activityLogs: { ...state.activityLogs, [conversationId]: entries },
    })),

  addActivityLog: (conversationId, entry) =>
    set((state) => {
      const existing = state.activityLogs[conversationId] ?? [];
      if (existing.some((e) => e.id === entry.id)) return state;
      return { activityLogs: { ...state.activityLogs, [conversationId]: [...existing, entry] } };
    }),

  setStatusCounts: (counts) => set({ statusCounts: counts }),
}));
