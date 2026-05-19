// Persists unsent messages and campaign drafts to IndexedDB so they survive page refreshes.

const DB_NAME = 'vzq_offline_v1';
const DB_VERSION = 1;

export interface QueuedMessage {
  id: string;
  tempId: string;
  conversationId: string;
  payload: {
    content?: string;
    type: string;
    replyToId?: string;
    mediaUrl?: string;
    mediaCaption?: string;
  };
  createdAt: string;
}

export interface QueuedCampaignDraft {
  id: string;
  audienceMode: 'segment' | 'label' | 'csv' | 'all';
  form: {
    name: string;
    templateId: string;
    segmentId?: string;
    labels?: string;
    csvPhones?: string[];
    scheduledAt?: string;
    templateVariables?: Record<string, string>;
  };
  createdAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('outbound_messages')) {
        db.createObjectStore('outbound_messages', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('campaign_drafts')) {
        db.createObjectStore('campaign_drafts', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function txGetAll<T>(store: string): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

function txPut<T>(store: string, value: T): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

function txDelete(store: string, key: IDBValidKey): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

export const offlineQueue = {
  enqueueMessage: (msg: QueuedMessage) => txPut('outbound_messages', msg),
  dequeueMessage: (id: string) => txDelete('outbound_messages', id),
  getAllMessages: () => txGetAll<QueuedMessage>('outbound_messages'),

  enqueueDraft: (draft: QueuedCampaignDraft) => txPut('campaign_drafts', draft),
  dequeueDraft: (id: string) => txDelete('campaign_drafts', id),
  getAllDrafts: () => txGetAll<QueuedCampaignDraft>('campaign_drafts'),
};
