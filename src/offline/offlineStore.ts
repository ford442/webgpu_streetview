export const OFFLINE_DB_NAME = 'webgpu-streetview-offline';
export const OFFLINE_DB_VERSION = 1;

export type OfflineStoreName =
  | 'bookmarks'
  | 'history'
  | 'tours'
  | 'snapshots'
  | 'panoMetadata'
  | 'routeGraph';

export interface PanoMetadata {
  panoId: string;
  lat: number;
  lng: number;
  imageDate?: string;
  heading?: number;
  cachedAt: string;
}

export interface RouteGraphNode {
  panoId: string;
  linkPanoIds: string[];
  lat: number;
  lng: number;
  routeId: string;
  cachedAt: string;
}

export interface OfflineRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error('Failed to open offline IndexedDB'));
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      const stores: OfflineStoreName[] = [
        'bookmarks',
        'history',
        'tours',
        'snapshots',
        'panoMetadata',
        'routeGraph',
      ];
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) {
          const objectStore = db.createObjectStore(store, { keyPath: 'key' });
          objectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      }
    };
  });
}

export async function offlineGet<T>(storeName: OfflineStoreName, key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => {
      const row = req.result as OfflineRecord<T> | undefined;
      resolve(row?.value ?? null);
    };
    req.onerror = () => reject(req.error ?? new Error(`offlineGet failed: ${storeName}/${key}`));
    tx.oncomplete = () => db.close();
  });
}

export async function offlineSet<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const record: OfflineRecord<T> = {
      key,
      value,
      updatedAt: new Date().toISOString(),
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`offlineSet failed: ${storeName}/${key}`));
    tx.oncomplete = () => db.close();
  });
}

export async function offlineDelete(storeName: OfflineStoreName, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`offlineDelete failed: ${storeName}/${key}`));
    tx.oncomplete = () => db.close();
  });
}

export async function offlineClearStore(storeName: OfflineStoreName): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`offlineClearStore failed: ${storeName}`));
    tx.oncomplete = () => db.close();
  });
}

export async function offlineClearAll(): Promise<void> {
  const stores: OfflineStoreName[] = [
    'bookmarks',
    'history',
    'tours',
    'snapshots',
    'panoMetadata',
    'routeGraph',
  ];
  await Promise.all(stores.map((store) => offlineClearStore(store)));
}

export async function offlineListKeys(storeName: OfflineStoreName): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAllKeys();
    req.onsuccess = () => resolve((req.result as string[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error(`offlineListKeys failed: ${storeName}`));
    tx.oncomplete = () => db.close();
  });
}

/** Primary blob key used for each metadata store (mirrors localStorage layout). */
export const OFFLINE_JSON_BLOB_KEY = 'data';

export async function offlineGetJson<T>(storeName: OfflineStoreName): Promise<T | null> {
  return offlineGet<T>(storeName, OFFLINE_JSON_BLOB_KEY);
}

export async function offlineSetJson<T>(storeName: OfflineStoreName, value: T): Promise<void> {
  return offlineSet(storeName, OFFLINE_JSON_BLOB_KEY, value);
}

export async function offlineUpsertPanoMetadata(entry: Omit<PanoMetadata, 'cachedAt'>): Promise<void> {
  const record: PanoMetadata = { ...entry, cachedAt: new Date().toISOString() };
  await offlineSet('panoMetadata', entry.panoId, record);
}

export async function offlineGetRouteGraph(routeId: string): Promise<RouteGraphNode[]> {
  const allKeys = await offlineListKeys('routeGraph');
  const prefix = `${routeId}:`;
  const nodes: RouteGraphNode[] = [];
  for (const key of allKeys) {
    if (!key.startsWith(prefix)) continue;
    const node = await offlineGet<RouteGraphNode>('routeGraph', key);
    if (node) nodes.push(node);
  }
  return nodes;
}

export async function offlineSaveRouteGraph(routeId: string, nodes: Omit<RouteGraphNode, 'routeId' | 'cachedAt'>[]): Promise<void> {
  const cachedAt = new Date().toISOString();
  await Promise.all(
    nodes.map((node) =>
      offlineSet('routeGraph', `${routeId}:${node.panoId}`, {
        ...node,
        routeId,
        cachedAt,
      }),
    ),
  );
}

/** All prefetched route-graph nodes across every route, deduplicated by their storage key. */
export async function offlineGetAllRouteGraphNodes(): Promise<RouteGraphNode[]> {
  const allKeys = await offlineListKeys('routeGraph');
  const nodes: RouteGraphNode[] = [];
  for (const key of allKeys) {
    const node = await offlineGet<RouteGraphNode>('routeGraph', key);
    if (node) nodes.push(node);
  }
  return nodes;
}

export interface RouteGraphSummary {
  routeId: string;
  nodeCount: number;
  cachedAt: string;
}

/** One summary row per prepared route graph, for storage-management UI. */
export async function offlineListRouteGraphs(): Promise<RouteGraphSummary[]> {
  const nodes = await offlineGetAllRouteGraphNodes();
  const summaries = new Map<string, RouteGraphSummary>();
  for (const node of nodes) {
    const existing = summaries.get(node.routeId);
    if (existing) {
      existing.nodeCount += 1;
      if (node.cachedAt > existing.cachedAt) existing.cachedAt = node.cachedAt;
    } else {
      summaries.set(node.routeId, { routeId: node.routeId, nodeCount: 1, cachedAt: node.cachedAt });
    }
  }
  return Array.from(summaries.values());
}

/** Delete every node belonging to one prepared route graph. */
export async function offlineDeleteRouteGraph(routeId: string): Promise<void> {
  const allKeys = await offlineListKeys('routeGraph');
  const prefix = `${routeId}:`;
  const keysToDelete = allKeys.filter((key) => key.startsWith(prefix));
  await Promise.all(keysToDelete.map((key) => offlineDelete('routeGraph', key)));
}
