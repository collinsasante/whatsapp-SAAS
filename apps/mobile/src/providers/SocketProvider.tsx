import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import {
  SocketEvent,
  type SocketNewMessageEvent,
  type SocketMessageStatusEvent,
  type SocketConversationUpdatedEvent,
  type SocketTypingEvent,
  type SocketAiSuggestionEvent,
} from '@whatsapp-platform/shared-types';
import { socketClient } from '../lib/socket';
import { useAuthStore } from '../store/auth.store';
import { useInboxStore } from '../store/inbox.store';
import type { MobileConversation } from '../store/inbox.store';
import { useCallsStore } from '../store/calls.store';

const CALL_TERMINAL_STATUSES = new Set([
  'ENDED', 'MISSED', 'DECLINED', 'CANCELED', 'UNANSWERED', 'BUSY', 'FAILED', 'COMPLETED', 'CANCELLED',
]);

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

    socket.on(SocketEvent.AI_SUGGESTION, (event: SocketAiSuggestionEvent) => {
      useInboxStore.getState().setAiSuggestion(event.conversationId, event.suggestion);
    });

    // Inbound WhatsApp call arriving -- mirrors apps/frontend's SocketProvider
    // exactly: skip if this agent is already on a call.
    const onIncomingCall = (data: {
      tenantId: string;
      call: { callLogId: string; whatsappCallId: string; from: string; contactName: string | null; sdpOffer: string | null };
    }) => {
      const { outboundCall, incomingCall } = useCallsStore.getState();
      if (outboundCall || incomingCall) return;
      useCallsStore.getState().setIncomingCall({
        callLogId: data.call.callLogId,
        whatsappCallId: data.call.whatsappCallId,
        from: data.call.from,
        contactName: data.call.contactName,
        sdpOffer: data.call.sdpOffer,
      });
    };
    socket.on('incoming_call', onIncomingCall);

    // Close the incoming-call UI when another agent answers, or the call
    // reaches a terminal status -- same dismissal rule as web.
    const onCallUpdated = (data: { tenantId: string; call: { id: string; status: string; userId?: string | null } }) => {
      if (data.call?.status === 'ONGOING') {
        const currentUserId = useAuthStore.getState().user?.id;
        if (data.call?.id && data.call.userId !== currentUserId) {
          useCallsStore.getState().clearCallIfMatches(data.call.id);
        }
        return;
      }
      if (CALL_TERMINAL_STATUSES.has(data.call?.status ?? '') && data.call?.id) {
        useCallsStore.getState().clearCallIfMatches(data.call.id);
      }
    };
    socket.on('call_updated', onCallUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off(SocketEvent.NEW_MESSAGE);
      socket.off(SocketEvent.CONVERSATION_UPDATED);
      socket.off(SocketEvent.TYPING_START);
      socket.off(SocketEvent.TYPING_STOP);
      socket.off(SocketEvent.MESSAGE_STATUS_UPDATE);
      socket.off(SocketEvent.AI_SUGGESTION);
      socket.off('incoming_call', onIncomingCall);
      socket.off('call_updated', onCallUpdated);
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
