import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OfflineMediaItem } from '../types/media';

interface ClipVaultDB extends DBSchema {
  media: {
    key: string;
    value: OfflineMediaItem;
    indexes: { 'by-created': number };
  };
}

const DB_NAME = 'clipvault-offline-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ClipVaultDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ClipVaultDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('media')) {
          const store = db.createObjectStore('media', { keyPath: 'id' });
          store.createIndex('by-created', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveOfflineMedia(item: OfflineMediaItem): Promise<void> {
  const db = await getDb();
  await db.put('media', item);
}

export async function listOfflineMedia(): Promise<OfflineMediaItem[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex('media', 'by-created');
  return items.reverse();
}

export async function getOfflineMediaById(id: string): Promise<OfflineMediaItem | undefined> {
  const db = await getDb();
  return db.get('media', id);
}

export async function deleteOfflineMedia(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('media', id);
}

export async function clearOfflineLibrary(): Promise<void> {
  const db = await getDb();
  await db.clear('media');
}

export async function estimateStorageUsage(): Promise<{ usedBytes: number; quotaBytes: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      return {
        usedBytes: est.usage || 0,
        quotaBytes: est.quota || 0,
      };
    } catch {
      // Fallback below
    }
  }
  const items = await listOfflineMedia();
  const usedBytes = items.reduce((acc, item) => acc + item.sizeBytes, 0);
  return { usedBytes, quotaBytes: 0 };
}
