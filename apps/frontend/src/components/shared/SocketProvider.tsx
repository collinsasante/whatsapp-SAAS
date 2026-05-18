'use client';
import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { getSocket, setSocketAuthErrorHandler, clearSocketAuth, SocketEvent } from '@/lib/socket';
import { callsApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import type { ActivityEntry } from '@/store/inbox.store';
import { useAuthStore } from '@/store/auth.store';
import { useCallsStore } from '@/store/calls.store';
import { Message, MessageStatus, MessageDirection } from '@whatsapp-platform/shared-types';
import { invalidateCannedCache } from '@/components/inbox/CannedPicker';

const MUTE_KEY = 'notifications_muted';
export const isMuted = () => typeof window !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
export const toggleMute = () => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MUTE_KEY, isMuted() ? '0' : '1');
  window.dispatchEvent(new CustomEvent('notifications:mute-changed'));
};

function requestBrowserNotificationPermission() {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

function showBrowserNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (isMuted()) return;
  try {
    new Notification(title, { body, icon: '/favicon.ico', tag: 'whatsapp-msg' });
  } catch { /* not supported */ }
}

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
  const { addMessage, updateMessage, updateMessageStatus, setTyping, prependConversation, updateConversation, markConversationRead, activeConversationId, addActivityLog, conversations } = useInboxStore();
  const { clearAuth } = useAuthStore();
  const { setIncomingCall, clearCallIfMatches, outboundSession, setOutboundSession } = useCallsStore();
  const router = useRouter();
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  // Ref so we can read current value inside socket handlers without adding to useEffect deps
  // (adding activeConversationId to deps tears down all listeners on every conversation click)
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(() => {
      window.dispatchEvent(new CustomEvent('socket:reconnect-poll'));
    }, 20_000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    requestBrowserNotificationPermission();
  }, []);

  useEffect(() => {
    setSocketAuthErrorHandler(() => {
      clearAuth();
      router.replace('/login?_r=socket-auth');
    });
    // On unmount: clear the handler and deauthorize the socket so stale connect_error
    // events can't fire the handler for a new session that's being set up.
    return () => clearSocketAuth();
  }, [clearAuth, router]);

  useEffect(() => {
    const socket = getSocket();

    socket.on('connect', stopPolling);
    socket.on('disconnect', startPolling);

    socket.on(SocketEvent.NEW_MESSAGE, (data: { conversationId: string; message: Message }) => {
      addMessage(data.conversationId, data.message);

      // If the message is for the currently open conversation, clear the unread badge
      if (data.message.direction === MessageDirection.INBOUND && data.conversationId === activeConversationIdRef.current) {
        markConversationRead(data.conversationId);
        void import('@/lib/api').then(({ conversationsApi }) => conversationsApi.markRead(data.conversationId).catch(() => {}));
      }

      if (
        data.message.direction === MessageDirection.INBOUND &&
        data.conversationId !== activeConversationIdRef.current
      ) {
        if (!isMuted()) playNotificationSound();

        // Find contact name for notifications
        const conv = conversationsRef.current.find((c) => c.id === data.conversationId);
        const contactName = conv?.contact?.name ?? conv?.contact?.phone ?? 'New message';
        const preview = data.message.content
          ? data.message.content.length > 60 ? `${data.message.content.slice(0, 60)}…` : data.message.content
          : data.message.type === 'IMAGE' ? '📷 Photo'
          : data.message.type === 'VIDEO' ? '🎥 Video'
          : data.message.type === 'AUDIO' ? '🎵 Audio'
          : data.message.type === 'DOCUMENT' ? '📄 Document'
          : 'New message';

        if (!isMuted()) {
          const initials = contactName.slice(0, 2).toUpperCase();
          toast.custom(
            (t) => (
              <div
                className={`flex items-center gap-3 bg-white rounded-2xl shadow-xl border border-gray-100 px-4 py-3 max-w-xs cursor-pointer transition-all ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
                style={{ minWidth: 280 }}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('inbox:open-conversation', { detail: { conversationId: data.conversationId } }));
                  toast.dismiss(t.id);
                }}
              >
                <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {conv?.contact?.avatarUrl
                    ? <img src={conv.contact.avatarUrl} alt={contactName} className="w-9 h-9 rounded-full object-cover" />
                    : initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">{contactName}</p>
                  <p className="text-xs text-gray-500 truncate">{preview}</p>
                </div>
                <span className="text-[10px] text-gray-300 flex-shrink-0">now</span>
              </div>
            ),
            { duration: 4500, id: `msg-${data.conversationId}` },
          );
          showBrowserNotification(contactName, preview);
        }
      }
    });

    socket.on(
      SocketEvent.CONVERSATION_UPDATED,
      (data: Record<string, unknown>) => {
        const id = (data.conversationId ?? data.id) as string;
        if (!id) return;
        // Only spread fields that are actually present in the event — never fabricate defaults
        // for missing fields (e.g. partial markRead events only carry { id, unreadCount })
        prependConversation({
          id,
          ...(data.contact != null ? { contact: data.contact as { id: string; name: string | null; phone: string; avatarUrl: string | null } } : {}),
          ...(data.assignedTo !== undefined ? { assignedTo: (data.assignedTo as { id: string; name: string } | null) } : {}),
          ...(data.status != null ? { status: data.status as string } : {}),
          ...(data.unreadCount != null ? { unreadCount: data.unreadCount as number } : {}),
          ...(data.lastMessageAt != null ? { lastMessageAt: data.lastMessageAt as string } : {}),
          ...(data.lastInboundAt != null ? { lastInboundAt: data.lastInboundAt as string } : {}),
          ...(data.labels != null ? { labels: data.labels as string[] } : {}),
          ...(data.channel != null ? { channel: data.channel as { id: string; type: string; name: string } } : {}),
          ...(data.requestedAt != null ? { requestedAt: data.requestedAt as string } : {}),
          ...(data.intervenedAt != null ? { intervenedAt: data.intervenedAt as string } : {}),
          ...(data.resolvedAt != null ? { resolvedAt: data.resolvedAt as string } : {}),
          ...(data.slaDeadline != null ? { slaDeadline: data.slaDeadline as string } : {}),
          ...(data.priority != null ? { priority: data.priority as number } : {}),
          ...(data.reopenedCount != null ? { reopenedCount: data.reopenedCount as number } : {}),
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

        // Use prependConversation so new conversations (not yet in list) also appear
        prependConversation({
          id,
          status: newStatus,
          ...(data.contact ? { contact: data.contact as { id: string; name: string | null; phone: string; avatarUrl: string | null } } : {}),
          assignedTo: (data.assignedTo as { id: string; name: string } | null) ?? null,
          lastMessageAt: (data.lastMessageAt as string) ?? null,
          lastInboundAt: (data.lastInboundAt as string) ?? undefined,
          labels: (data.labels as string[]) ?? [],
          channel: data.channel as { id: string; type: string; name: string } | undefined,
          requestedAt: (data.requestedAt as string) ?? undefined,
          intervenedAt: (data.intervenedAt as string) ?? undefined,
          resolvedAt: (data.resolvedAt as string) ?? undefined,
          slaDeadline: (data.slaDeadline as string) ?? undefined,
          priority: (data.priority as number) ?? 0,
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
      'reaction_updated',
      (data: { conversationId: string; messageId: string; reactions: Array<{ id: string; emoji: string; userId: string | null }> }) => {
        if (data.conversationId && data.messageId) {
          updateMessage(data.conversationId, data.messageId, { messageReactions: data.reactions } as Partial<Message>);
        }
      },
    );

    // Realtime notifications — surface visible toast + chime for high-signal events.
    // (NotificationBell separately handles the same event to update the bell badge/store.)
    type NotificationPayload = { id: string; type: string; title: string; body: string; link?: string | null; metadata?: Record<string, unknown> | null };
    const notificationHandler = (data: NotificationPayload) => {
      if (isMuted()) return;
      if (data.type !== 'CONVERSATION_ASSIGNED') return;

      playNotificationSound();
      const convId = (data.metadata && typeof data.metadata === 'object' ? (data.metadata as { conversationId?: string }).conversationId : null) ?? null;
      toast.custom(
        (t) => (
          <div
            className={`flex items-center gap-3 bg-white rounded-2xl shadow-xl border border-indigo-100 px-4 py-3 max-w-xs cursor-pointer transition-all ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
            style={{ minWidth: 280 }}
            onClick={() => {
              if (convId) {
                window.dispatchEvent(new CustomEvent('inbox:open-conversation', { detail: { conversationId: convId } }));
              } else if (data.link) {
                router.push(data.link);
              }
              toast.dismiss(t.id);
            }}
          >
            <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">{data.title}</p>
              <p className="text-xs text-gray-500 truncate">{data.body}</p>
            </div>
            <span className="text-[10px] text-gray-300 flex-shrink-0">now</span>
          </div>
        ),
        { duration: 6000, id: `notif-${data.id}` },
      );
      showBrowserNotification(data.title, data.body);
    };
    socket.on('notification:new', notificationHandler);

    // Force logout — admin suspended/removed/forced or password reset
    socket.on(
      'force_logout',
      (data: { userId: string; reason: string }) => {
        const storedToken = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
        // Only act if this event targets the current user (matched via stored JWT sub)
        // We use a loose check: if userId is present, we trust the server routed it correctly
        if (!data.userId) return;
        clearAuth();
        localStorage.removeItem('access_token');
        const messages: Record<string, string> = {
          suspended: 'Your account has been suspended.',
          removed: 'You have been removed from this workspace.',
          forced: 'You have been logged out by an administrator.',
          password_reset: 'Your password was reset. Please log in again.',
        };
        const msg = messages[data.reason] ?? 'You have been logged out.';
        router.replace(`/login?_r=force-logout&reason=${encodeURIComponent(msg)}`);
        void storedToken; // suppress unused warning
      },
    );

    // Role changed — user needs a fresh token with updated role
    socket.on(
      'role_changed',
      (_data: { userId: string; newRole: string; tenantId: string }) => {
        // Trigger a silent token refresh so the new role is reflected in the JWT
        import('@/lib/api').then(({ silentRefresh }) => {
          silentRefresh().catch(() => {
            clearAuth();
            router.replace('/login?_r=role-change');
          });
        });
      },
    );

    // Member profile updated — notify settings page to refresh member list
    socket.on(
      'member_updated',
      (data: { tenantId: string; userId: string; changes: Record<string, unknown> }) => {
        window.dispatchEvent(new CustomEvent('workspace:member-updated', { detail: data }));
      },
    );

    // Conversations bulk-reassigned — notify inbox to re-fetch
    socket.on(
      'conversations_reassigned',
      (_data: { tenantId: string; fromUserId: string; toUserId: string; count: number }) => {
        window.dispatchEvent(new CustomEvent('workspace:conversations-reassigned'));
      },
    );

    // Canned responses updated — invalidate picker cache so next open fetches fresh data
    socket.on('canned_responses_updated', () => {
      invalidateCannedCache();
    });

    // Inbound WhatsApp call arriving — skip if this agent is already on a call
    const onIncomingCall = (data: { tenantId: string; call: { callLogId: string; whatsappCallId: string; from: string; contactName: string | null; sdpOffer: string | null } }) => {
      const { outboundCall, incomingCall } = useCallsStore.getState();
      if (outboundCall || incomingCall) return; // agent already on a call
      setIncomingCall({
        callLogId: data.call.callLogId,
        whatsappCallId: data.call.whatsappCallId,
        from: data.call.from,
        contactName: data.call.contactName,
        sdpOffer: data.call.sdpOffer,
      });
    };
    socket.on('incoming_call', onIncomingCall);

    // Close incoming call modal when one agent answers or the call terminates
    const onCallUpdated = (data: { tenantId: string; call: { id: string; status: string; userId?: string | null } }) => {
      if (data.call?.status === 'ONGOING') {
        // Another agent answered — dismiss for everyone except the agent who answered,
        // since that agent's IncomingCallModal still needs incomingCall to hang up.
        const currentUserId = useAuthStore.getState().user?.id;
        if (data.call?.id && data.call.userId !== currentUserId) {
          clearCallIfMatches(data.call.id);
        }
        return;
      }
      const shouldDismiss = ['ENDED', 'MISSED', 'DECLINED', 'CANCELED', 'UNANSWERED', 'BUSY', 'FAILED',
        'COMPLETED', 'CANCELLED'].includes(data.call?.status ?? '');
      if (shouldDismiss && data.call?.id) clearCallIfMatches(data.call.id);
    };
    socket.on('call_updated', onCallUpdated);


    return () => {
      socket.off('connect', stopPolling);
      socket.off('disconnect', startPolling);
      stopPolling();
      socket.off(SocketEvent.NEW_MESSAGE);
      socket.off(SocketEvent.CONVERSATION_UPDATED);
      socket.off('conversation_state_changed');
      socket.off(SocketEvent.MESSAGE_STATUS_UPDATE);
      socket.off(SocketEvent.TYPING_START);
      socket.off(SocketEvent.TYPING_STOP);
      socket.off(SocketEvent.ACTIVITY_LOG);
      socket.off('reaction_updated');
      socket.off('force_logout');
      socket.off('role_changed');
      socket.off('member_updated');
      socket.off('conversations_reassigned');
      socket.off('canned_responses_updated');
      // Pass handler refs so we don't tear down other components' listeners for the same event.
      socket.off('notification:new', notificationHandler);
      socket.off('incoming_call', onIncomingCall);
      socket.off('call_updated', onCallUpdated);
    };
  // NOTE: activeConversationId intentionally excluded — we use activeConversationIdRef instead
  // to avoid tearing down all socket listeners on every conversation switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMessage, updateMessage, updateMessageStatus, setTyping, prependConversation, updateConversation, addActivityLog, clearAuth, router, startPolling, stopPolling, setIncomingCall, clearCallIfMatches]);

  return <>{children}</>;
}
