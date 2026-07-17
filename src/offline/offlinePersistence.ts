import {
  offlineGetJson,
  offlineSetJson,
  type OfflineStoreName,
} from './offlineStore';

/** localStorage keys mirrored into IndexedDB for offline metadata (Phase 2). */
export const LOCAL_STORAGE_MIRROR: Record<OfflineStoreName, string | null> = {
  bookmarks: 'webgpu_streetview_bookmarks',
  history: 'webgpu_streetview_history',
  tours: 'webgpu_streetview_tours',
  snapshots: 'webgpu_streetview_snapshots',
  panoMetadata: null,
  routeGraph: null,
};

const MIRROR_STORES = (Object.keys(LOCAL_STORAGE_MIRROR) as OfflineStoreName[]).filter(
  (store) => LOCAL_STORAGE_MIRROR[store] !== null,
);

function readLocalStorageJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocalStorageJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Migrate localStorage blobs into IndexedDB (one-way, idempotent). */
export async function migrateLocalStorageToIndexedDB(): Promise<void> {
  for (const store of MIRROR_STORES) {
    const lsKey = LOCAL_STORAGE_MIRROR[store]!;
    const existing = await offlineGetJson(store);
    if (existing !== null) continue;

    const fromLocal = readLocalStorageJson(lsKey);
    if (fromLocal !== null) {
      await offlineSetJson(store, fromLocal);
    }
  }
}

/** Prefer IndexedDB, fall back to localStorage, optionally hydrate IDB. */
export async function loadMirroredJson<T>(store: OfflineStoreName): Promise<T | null> {
  const lsKey = LOCAL_STORAGE_MIRROR[store];
  const fromIdb = await offlineGetJson<T>(store);
  if (fromIdb !== null) {
    if (lsKey) writeLocalStorageJson(lsKey, fromIdb);
    return fromIdb;
  }

  if (!lsKey) return null;
  const fromLocal = readLocalStorageJson<T>(lsKey);
  if (fromLocal !== null) {
    await offlineSetJson(store, fromLocal);
  }
  return fromLocal;
}

/** Persist to IndexedDB and mirror to localStorage when configured. */
export async function saveMirroredJson<T>(store: OfflineStoreName, value: T): Promise<void> {
  await offlineSetJson(store, value);
  const lsKey = LOCAL_STORAGE_MIRROR[store];
  if (lsKey) writeLocalStorageJson(lsKey, value);
}

export function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
