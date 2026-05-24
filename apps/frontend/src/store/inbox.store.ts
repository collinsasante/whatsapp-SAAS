'use client';
import { create } from 'zustand';
import { Message, MessageDirection } from '@whatsapp-platform/shared-types';

export interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  user?: { id: string; name: string } | null;
}

export interface Conversation {
  id: string;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt?: string | null;
  labels: string[];
  messages?: Array<{ id?: string; content: string | null; type: string; direction?: string }>;
  channel?: { id: string; type: string; name: string };
  requestedAt?: string;
  intervenedAt?: string;
  resolvedAt?: string;
  slaDeadline?: string;
  priority?: number;
  reopenedCount?: number;
  contactSource?: string;
  adSourceId?: string | null;
  adHeadline?: string | null;
  snoozedUntil?: string | null;
}

export interface StatusCounts {
  OPEN: number;
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
  // Adds to top if new, updates IN-PLACE (no reorder) if already in the list
  prependConversation: (conversation: Partial<Conversation> & { id: string }) => void;
  // Moves conversation to top — only for new-message events
  bumpConversation: (id: string) => void;
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
  patchActivityLog: (conversationId: string, entryId: string, patch: Partial<ActivityEntry>) => void;
  setStatusCounts: (counts: StatusCounts) => void;
  markConversationRead: (id: string) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  typingUsers: {},
  activityLogs: {},
  statusCounts: { OPEN: 0, REQUESTED: 0, INTERVENED: 0, RESOLVED: 0 },

  setConversations: (conversations) => set({ conversations }),

  // Merges partial data into an existing conversation IN-PLACE (no reorder).
  // If the conversation is not yet in the list, adds it to the top (brand new).
  prependConversation: (conversation) =>
    set((state) => {
      const existing = state.conversations.find((c) => c.id === conversation.id);
      if (existing) {
        // Update in-place — preserve position in the list
        const merged: Conversation = {
          ...existing,
          ...conversation,
          contact: conversation.contact ?? existing.contact,
          channel: conversation.channel ?? existing.channel,
          labels: conversation.labels ?? existing.labels ?? [],
          assignedTo: conversation.assignedTo !== undefined ? conversation.assignedTo : existing.assignedTo,
          status: conversation.status ?? existing.status,
          lastInboundAt: conversation.lastInboundAt !== undefined ? conversation.lastInboundAt : existing.lastInboundAt,
          messages: conversation.messages ?? existing.messages,
        };
        return {
          conversations: state.conversations.map((c) => c.id === conversation.id ? merged : c),
        };
      }
      // New conversation not yet in list — add to top
      const merged: Conversation = {
        assignedTo: null,
        status: 'REQUESTED',
        unreadCount: 0,
        lastMessageAt: null,
        labels: [],
        ...conversation,
      } as Conversation;
      return { conversations: [merged, ...state.conversations] };
    }),

  // Move an existing conversation to the top (called only on new message).
  bumpConversation: (id) =>
    set((state) => {
      const conv = state.conversations.find((c) => c.id === id);
      if (!conv) return state;
      return { conversations: [conv, ...state.conversations.filter((c) => c.id !== id)] };
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      // Skip exact duplicate
      if (existing.some((m) => m.id === message.id)) return state;

      // Replace matching optimistic (temp-*) message with the real one
      const withoutOptimistic = existing.filter((m) => {
        if (!m.id.startsWith('temp-')) return true;
        const tempTime = parseInt(m.id.replace('temp-', ''), 10);
        if (Date.now() - tempTime > 15_000) return true;
        return m.content !== message.content || m.direction !== message.direction;
      });

      const isInbound = message.direction === MessageDirection.INBOUND;
      const inboundUpdate = isInbound ? { lastInboundAt: message.createdAt as unknown as string } : {};
      const isActiveConv = conversationId === state.activeConversationId;

      const updatedConv = state.conversations.find((c) => c.id === conversationId);
      // Zero badge for outbound or when agent is viewing this conversation; increment for unread inbound
      const badgeUpdate = (!isInbound || isActiveConv)
        ? { unreadCount: 0 }
        : { unreadCount: (updatedConv?.unreadCount ?? 0) + 1 };
      const updatedConvData = updatedConv
        ? {
            ...updatedConv,
            lastMessageAt: message.createdAt as unknown as string,
            messages: [{ id: message.id, content: message.content, type: message.type, direction: message.direction }],
            ...inboundUpdate,
            ...badgeUpdate,
          }
        : null;

      return {
        messages: {
          ...state.messages,
          [conversationId]: [...withoutOptimistic, message],
        },
        // New message always moves conversation to top (WhatsApp behaviour)
        conversations: updatedConvData
          ? [updatedConvData, ...state.conversations.filter((c) => c.id !== conversationId)]
          : state.conversations,
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

  patchActivityLog: (conversationId, entryId, patch) =>
    set((state) => {
      const existing = state.activityLogs[conversationId] ?? [];
      const updated = existing.map((e) => e.id === entryId ? { ...e, ...patch } : e);
      return { activityLogs: { ...state.activityLogs, [conversationId]: updated } };
    }),

  setStatusCounts: (counts) => set({ statusCounts: counts }),

  markConversationRead: (id) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: 0 } : c,
      ),
    })),
}));
