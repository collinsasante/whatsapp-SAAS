'use client';
import { useEffect } from 'react';
import { getSocket, SocketEvent } from '@/lib/socket';
import { useInboxStore } from '@/store/inbox.store';
import { Message, MessageStatus } from '@whatsapp-platform/shared-types';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { addMessage, updateMessageStatus, setTyping } = useInboxStore();

  useEffect(() => {
    const socket = getSocket();

    socket.on(SocketEvent.NEW_MESSAGE, (data: { conversationId: string; message: Message }) => {
      addMessage(data.conversationId, data.message);
    });

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
      socket.off(SocketEvent.MESSAGE_STATUS_UPDATE);
      socket.off(SocketEvent.TYPING_START);
      socket.off(SocketEvent.TYPING_STOP);
    };
  }, [addMessage, updateMessageStatus, setTyping]);

  return <>{children}</>;
}
