'use client';
import { create } from 'zustand';
import { Message } from '@whatsapp-platform/shared-types';

interface Conversation {
  id: string;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  labels: string[];
  messages?: Message[];
}

interface InboxState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  typingUsers: Record<string, string[]>;
  setConversations: (conversations: Conversation[]) => void;
  prependConversation: (conversation: Conversation) => void;
  setActiveConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  updateConversation: (id: string, data: Partial<Conversation>) => void;
  updateMessageStatus: (conversationId: string, messageId: string, status: string) => void;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  typingUsers: {},

  setConversations: (conversations) => set({ conversations }),

  prependConversation: (conversation) =>
    set((state) => ({ conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)] })),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        messages: {
          ...state.messages,
          [conversationId]: [...existing, message],
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

  setTyping: (conversationId, userId, isTyping) =>
    set((state) => {
      const current = state.typingUsers[conversationId] ?? [];
      const updated = isTyping
        ? Array.from(new Set([...current, userId]))
        : current.filter((id) => id !== userId);
      return { typingUsers: { ...state.typingUsers, [conversationId]: updated } };
    }),
}));
