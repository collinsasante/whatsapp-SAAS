'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket, setSocketAuthErrorHandler, SocketEvent } from '@/lib/socket';
import { useInboxStore } from '@/store/inbox.store';
import type { ActivityEntry } from '@/store/inbox.store';
import { useAuthStore } from '@/store/auth.store';
import { Message, MessageStatus, MessageDirection } from '@whatsapp-platform/shared-types';

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const playBeep = (time: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.start(time);
      osc.stop(time + dur);
    };
    playBeep(ctx.currentTime, 784, 0.12);
    playBeep(ctx.currentTime + 0.13, 1046, 0.18);
  } catch { /* audio not available */ }
}

function playRequestSound() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    // Urgent triple beep for support requests
    [0, 0.15, 0.30].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = 880 + i * 110;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.1);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.1);
    });
  } catch { /* audio not available */ }
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { addMessage, updateMessage, updateMessageStatus, setTyping, prependConversation, updateConversation, removeMessage, activeConversationId, addActivityLog } = useInboxStore();
  const { clearAuth } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    setSocketAuthErrorHandler(() => {
      clearAuth();
      router.replace('/login');
    });
  }, [clearAuth, router]);

  useEffect(() => {
    const socket = getSocket();

    socket.on(SocketEvent.NEW_MESSAGE, (data: { conversationId: string; message: Message }) => {
      addMessage(data.conversationId, data.message);
      if (
        data.message.direction === MessageDirection.INBOUND &&
        data.conversationId !== activeConversationId
      ) {
        playNotificationSound();
      }
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
          requestedAt: (data.requestedAt as string) ?? undefined,
          intervenedAt: (data.intervenedAt as string) ?? undefined,
          resolvedAt: (data.resolvedAt as string) ?? undefined,
          slaDeadline: (data.slaDeadline as string) ?? undefined,
          priority: (data.priority as number) ?? 0,
          reopenedCount: (data.reopenedCount as number) ?? 0,
        });
      },
    );

    // Dedicated state change event — same shape, but also plays alert sound
    socket.on(
      'conversation_state_changed',
      (data: Record<string, unknown>) => {
        const id = (data.conversationId ?? data.id) as string;
        const newStatus = data.status as string;
        if (!id) return;

        updateConversation(id, {
          status: newStatus,
          assignedTo: (data.assignedTo as { id: string; name: string } | null) ?? undefined,
          requestedAt: (data.requestedAt as string) ?? undefined,
          intervenedAt: (data.intervenedAt as string) ?? undefined,
          resolvedAt: (data.resolvedAt as string) ?? undefined,
          slaDeadline: (data.slaDeadline as string) ?? undefined,
          reopenedCount: (data.reopenedCount as number) ?? 0,
        });

        if (newStatus === 'REQUESTED') {
          playRequestSound();
        }
        // Trigger counts refresh in InboxPage
        window.dispatchEvent(new CustomEvent('conversation:state-changed'));
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

    socket.on(
      SocketEvent.ACTIVITY_LOG,
      (data: { conversationId: string; activity: ActivityEntry }) => {
        if (data.conversationId && data.activity) {
          addActivityLog(data.conversationId, data.activity);
        }
      },
    );

    socket.on(
      'message_edited',
      (data: { conversationId: string; message: Message }) => {
        if (data.conversationId && data.message?.id) {
          updateMessage(data.conversationId, data.message.id, data.message);
        }
      },
    );

    socket.on(
      'message_deleted',
      (data: { conversationId: string; messageId: string; scope: string }) => {
        if (!data.conversationId || !data.messageId) return;
        if (data.scope === 'everyone') {
          updateMessage(data.conversationId, data.messageId, {
            deletedForEveryone: true,
            content: null,
            mediaUrl: null,
            mediaCaption: null,
          } as Partial<Message>);
        } else {
          removeMessage(data.conversationId, data.messageId);
        }
      },
    );

    socket.on(
      'reaction_updated',
      (data: { conversationId: string; messageId: string; reactions: Array<{ id: string; emoji: string; userId: string | null }> }) => {
        if (data.conversationId && data.messageId) {
          updateMessage(data.conversationId, data.messageId, { messageReactions: data.reactions } as Partial<Message>);
        }
      },
    );

    return () => {
      socket.off(SocketEvent.NEW_MESSAGE);
      socket.off(SocketEvent.CONVERSATION_UPDATED);
      socket.off('conversation_state_changed');
      socket.off(SocketEvent.MESSAGE_STATUS_UPDATE);
      socket.off(SocketEvent.TYPING_START);
      socket.off(SocketEvent.TYPING_STOP);
      socket.off(SocketEvent.ACTIVITY_LOG);
      socket.off('message_edited');
      socket.off('message_deleted');
      socket.off('reaction_updated');
    };
  }, [addMessage, updateMessage, updateMessageStatus, setTyping, prependConversation, updateConversation, removeMessage, activeConversationId, addActivityLog]);

  return <>{children}</>;
}
