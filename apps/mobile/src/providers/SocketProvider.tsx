import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import {
  SocketEvent,
  type SocketNewMessageEvent,
  type SocketMessageStatusEvent,
  type SocketConversationUpdatedEvent,
  type SocketTypingEvent,
} from '@whatsapp-platform/shared-types';
import { socketClient } from '../lib/socket';
import { useAuthStore } from '../store/auth.store';
import { useInboxStore } from '../store/inbox.store';
import type { MobileConversation } from '../store/inbox.store';

const SocketContext = createContext<{ socket: Socket | null }>({ socket: null });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tenantId = useAuthStore((s) => s.tenant?.id);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      socketClient.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = socketClient.connect();
    socketRef.current = socket;

    const onConnect = () => {
      if (tenantId) {
        socket.emit(SocketEvent.JOIN_TENANT, { tenantId });
      }
    };

    socket.on('connect', onConnect);
    if (socket.connected && tenantId) {
      socket.emit(SocketEvent.JOIN_TENANT, { tenantId });
    }

    socket.on(SocketEvent.NEW_MESSAGE, (event: SocketNewMessageEvent) => {
      const store = useInboxStore.getState();
      store.addMessage(event.conversationId, event.message);
      store.updateConversation(event.conversationId, {
        lastMessageAt: new Date().toISOString(),
      });
    });

    socket.on(SocketEvent.CONVERSATION_UPDATED, (event: SocketConversationUpdatedEvent) => {
      useInboxStore
        .getState()
        .updateConversation(
          event.conversation.id,
          event.conversation as Partial<MobileConversation>,
        );
    });

    socket.on(SocketEvent.TYPING_START, (event: SocketTypingEvent) => {
      useInboxStore.getState().setTyping(event.conversationId, event.userId, true);
    });

    socket.on(SocketEvent.TYPING_STOP, (event: SocketTypingEvent) => {
      useInboxStore.getState().setTyping(event.conversationId, event.userId, false);
    });

    socket.on(SocketEvent.MESSAGE_STATUS_UPDATE, (event: SocketMessageStatusEvent) => {
      useInboxStore
        .getState()
        .updateMessageStatus(event.messageId, event.whatsappMessageId, event.status);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off(SocketEvent.NEW_MESSAGE);
      socket.off(SocketEvent.CONVERSATION_UPDATED);
      socket.off(SocketEvent.TYPING_START);
      socket.off(SocketEvent.TYPING_STOP);
      socket.off(SocketEvent.MESSAGE_STATUS_UPDATE);
      socketClient.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, tenantId]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): Socket | null {
  return useContext(SocketContext).socket;
}
