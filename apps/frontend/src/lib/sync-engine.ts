import { offlineQueue } from './offline-queue';
import { messagesApi, campaignsApi } from './api';
import { useInboxStore } from '@/store/inbox.store';
import { useOfflineStore } from '@/store/offline.store';
import type { Message } from '@whatsapp-platform/shared-types';

async function refreshCounts() {
  try {
    const [msgs, drafts] = await Promise.all([
      offlineQueue.getAllMessages(),
      offlineQueue.getAllDrafts(),
    ]);
    useOfflineStore.getState().setQueuedCounts(msgs.length, drafts.length);
  } catch {
    // IndexedDB unavailable/broken on this device — offline queueing is a best-effort
    // feature, not a hard requirement. Never let it crash the sync flow.
  }
}

export async function flushOfflineQueue(): Promise<void> {
  const { setSyncing, setLastSyncedCount } = useOfflineStore.getState();
  const { addMessage, removeMessage } = useInboxStore.getState();

  await refreshCounts();
  const { queuedMessages, queuedDrafts } = useOfflineStore.getState();
  if (queuedMessages === 0 && queuedDrafts === 0) return;

  setSyncing(true);
  let synced = 0;

  try {
    const messages = await offlineQueue.getAllMessages();
    for (const qm of messages) {
      try {
        const res = await messagesApi.send(qm.conversationId, qm.payload);
        const real = res.data as Message;
        if (real?.id) {
          removeMessage(qm.conversationId, qm.tempId);
          addMessage(qm.conversationId, real);
        }
        await offlineQueue.dequeueMessage(qm.id);
        synced++;
      } catch {
        // Stop on first failure — network may still be flaky
        break;
      }
    }

    const drafts = await offlineQueue.getAllDrafts();
    for (const draft of drafts) {
      try {
        const audiencePayload: Record<string, unknown> = {};
        if (draft.audienceMode === 'segment' && draft.form.segmentId) {
          audiencePayload['segmentId'] = draft.form.segmentId;
        } else if (draft.audienceMode === 'label' && draft.form.labels) {
          audiencePayload['labels'] = draft.form.labels.split(',').map((l) => l.trim()).filter(Boolean);
        } else if (draft.audienceMode === 'csv' && draft.form.csvPhones?.length) {
          audiencePayload['phones'] = draft.form.csvPhones;
        }

        await campaignsApi.create({
          name: draft.form.name,
          templateId: draft.form.templateId,
          ...audiencePayload,
          scheduledAt: draft.form.scheduledAt || undefined,
          templateVariables:
            draft.form.templateVariables && Object.keys(draft.form.templateVariables).length
              ? draft.form.templateVariables
              : undefined,
        });
        await offlineQueue.dequeueDraft(draft.id);
        synced++;
      } catch {
        break;
      }
    }
  } catch {
    // offlineQueue reads themselves failed (e.g. IndexedDB broken) — nothing to sync.
  } finally {
    await refreshCounts();
    setSyncing(false);
    if (synced > 0) setLastSyncedCount(synced);
  }
}
