import { create } from 'zustand';
import type { Message, MessageStatus } from '@whatsapp-platform/shared-types';

export interface MobileConversation {
  id: string;
  contact: {
    id: string;
    name: string | null;
    phone: string;
    avatarUrl: string | null;
  };
  assignedTo: { id: string; name: string } | null;
  status: string;
  priority?: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessage?: { content: string | null; type: string; direction: string } | null;
  labels: string[];
  channel?: { id: string; type: string; name: string };
  snoozedUntil?: string | null;
}

interface InboxState {
  conversations: MobileConversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  messageCursors: Record<string, string | null>;
  hasMoreMessages: Record<string, boolean>;
  typingUsers: Record<string, string[]>;
  isLoading: boolean;

  setConversations: (conversations: MobileConversation[]) => void;
  prependConversation: (conv: Partial<MobileConversation> & { id: string }) => void;
  setActiveConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setMessages: (conversationId: string, messages: Message[], hasMore?: boolean) => void;
  prependMessages: (conversationId: string, messages: Message[]) => void;
  setMessageCursor: (conversationId: string, cursor: string | null, hasMore: boolean) => void;
  updateConversation: (id: string, data: Partial<MobileConversation>) => void;
  removeConversation: (id: string) => void;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
  updateMessageStatus: (messageId: string, whatsappMessageId: string | null, status: MessageStatus) => void;
  setLoading: (loading: boolean) => void;
}

export const useInboxStore = create<InboxState>()((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  messageCursors: {},
  hasMoreMessages: {},
  typingUsers: {},
  isLoading: false,

  setConversations: (conversations) => set({ conversations }),

  prependConversation: (conv) =>
    set((state) => {
      const exists = state.conversations.findIndex((c) => c.id === conv.id);
      if (exists >= 0) {
        const updated = [...state.conversations];
        updated[exists] = { ...updated[exists]!, ...conv };
        return { conversations: updated };
      }
      return { conversations: [conv as MobileConversation, ...state.conversations] };
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (conversationId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] ?? []), message],
      },
    })),

  setMessages: (conversationId, messages, hasMore = false) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
      hasMoreMessages: { ...state.hasMoreMessages, [conversationId]: hasMore },
      messageCursors: {
        ...state.messageCursors,
        [conversationId]: messages[0]
          ? new Date(messages[0].createdAt).toISOString()
          : null,
      },
    })),

  setMessageCursor: (conversationId, cursor, hasMore) =>
    set((state) => ({
      messageCursors: { ...state.messageCursors, [conversationId]: cursor },
      hasMoreMessages: { ...state.hasMoreMessages, [conversationId]: hasMore },
    })),

  prependMessages: (conversationId, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...messages, ...(state.messages[conversationId] ?? [])],
      },
    })),

  updateConversation: (id, data) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...data } : c,
      ),
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
    })),

  setTyping: (conversationId, userId, isTyping) =>
    set((state) => {
      const current = state.typingUsers[conversationId] ?? [];
      return {
        typingUsers: {
          ...state.typingUsers,
          [conversationId]: isTyping
            ? [...new Set([...current, userId])]
            : current.filter((id) => id !== userId),
        },
      };
    }),

  setLoading: (isLoading) => set({ isLoading }),

  updateMessageStatus: (messageId, whatsappMessageId, status) =>
    set((state) => {
      for (const [convId, msgs] of Object.entries(state.messages)) {
        const idx = msgs.findIndex(
          (m) => m.id === messageId || (whatsappMessageId && m.whatsappMessageId === whatsappMessageId),
        );
        if (idx >= 0) {
          const updated = [...msgs];
          updated[idx] = { ...updated[idx]!, status };
          return { messages: { ...state.messages, [convId]: updated } };
        }
      }
      return {};
    }),
}));
