'use client';
import { useEffect } from 'react';
import { getSocket, SocketEvent } from '@/lib/socket';
import { useInboxStore } from '@/store/inbox.store';
import { Message, MessageStatus } from '@whatsapp-platform/shared-types';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { addMessage, updateMessageStatus, setTyping, prependConversation } = useInboxStore();

  useEffect(() => {
    const socket = getSocket();

    socket.on(SocketEvent.NEW_MESSAGE, (data: { conversationId: string; message: Message }) => {
      addMessage(data.conversationId, data.message);
    });

    socket.on(
      SocketEvent.CONVERSATION_UPDATED,
      (data: Record<string, unknown>) => {
        const id = (data.conversationId ?? data.id) as string;
        if (!id) return;
        prependConversation({
          id,
          contact: data.contact as { id: string; name: string | null; phone: string; avatarUrl: string | null },
          assignedTo: (data.assignedTo as { id: string; name: string } | null) ?? null,
          status: (data.status as string) ?? 'OPEN',
          unreadCount: (data.unreadCount as number) ?? 0,
          lastMessageAt: (data.lastMessageAt as string) ?? null,
          labels: (data.labels as string[]) ?? [],
        });
      },
    );

    socket.on(
      SocketEvent.MESSAGE_STATUS_UPDATE,
      (data: { conversationId: string; messageId: string; status: MessageStatus }) => {
        updateMessageStatus(data.conversationId, data.messageId, data.status);
      },
    );

    socket.on(
      SocketEvent.TYPING_START,
      (data: { conversationId: string; userId: string }) => {
        setTyping(data.conversationId, data.userId, true);
      },
    );

    socket.on(
      SocketEvent.TYPING_STOP,
      (data: { conversationId: string; userId: string }) => {
        setTyping(data.conversationId, data.userId, false);
      },
    );

    return () => {
      socket.off(SocketEvent.NEW_MESSAGE);
      socket.off(SocketEvent.CONVERSATION_UPDATED);
      socket.off(SocketEvent.MESSAGE_STATUS_UPDATE);
      socket.off(SocketEvent.TYPING_START);
      socket.off(SocketEvent.TYPING_STOP);
    };
  }, [addMessage, updateMessageStatus, setTyping, prependConversation]);

  return <>{children}</>;
}
