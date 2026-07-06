import React, { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';
import { registerForPushNotifications } from '../lib/notifications';
import { useAuthStore } from '../store/auth.store';
import { useMessageQueueStore } from '../store/message-queue.store';
import { apiClient } from '../lib/api';

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const lastAppState = useRef<AppStateStatus>(AppState.currentState);

  // Register push token when user logs in
  useEffect(() => {
    if (!isAuthenticated) return;
    registerForPushNotifications().catch(() => null);
  }, [isAuthenticated]);

  // Handle foreground notifications
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      // Update unread badge for conversations if data includes conversationId
      void data;
    });

    const response = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp.notification.request.content.data as Record<string, unknown>;
      if (typeof data.conversationId === 'string') {
        router.push(`/(app)/inbox/${data.conversationId}`);
      } else {
        router.push('/(app)/settings/notifications');
      }
    });

    return () => {
      received.remove();
      response.remove();
    };
  }, []);

  // Drain the send queue when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && lastAppState.current !== 'active' && isAuthenticated) {
        drainMessageQueue();
      }
      lastAppState.current = next;
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  return <>{children}</>;
}

async function drainMessageQueue() {
  const { queue, dequeue, incrementRetry, pruneExhausted, isProcessing, setProcessing } =
    useMessageQueueStore.getState();

  if (isProcessing || queue.length === 0) return;
  setProcessing(true);
  pruneExhausted();

  const pending = useMessageQueueStore.getState().queue;
  for (const msg of pending) {
    try {
      await apiClient.messages.send(msg.conversationId, {
        type: msg.type,
        content: msg.content,
      });
      dequeue(msg.id);
    } catch {
      incrementRetry(msg.id);
    }
  }
  setProcessing(false);
}
