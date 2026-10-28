import { isOfflineCacheName } from './swPolicy';
import { offlineClearAll } from './offlineStore';

export interface ClearOfflineCachesResult {
  deletedCacheNames: string[];
}

export async function clearOfflineCaches(): Promise<ClearOfflineCachesResult> {
  if (!('caches' in window)) {
    return { deletedCacheNames: [] };
  }
  const keys = await caches.keys();
  const toDelete = keys.filter(isOfflineCacheName);
  await Promise.all(toDelete.map((name) => caches.delete(name)));
  return { deletedCacheNames: toDelete };
}

export async function clearAllOfflineData(): Promise<void> {
  await clearOfflineCaches();
  await offlineClearAll();

  const localKeys = [
    'webgpu_streetview_bookmarks',
    'webgpu_streetview_history',
    'webgpu_streetview_tours',
    'webgpu_streetview_snapshots',
  ];
  for (const key of localKeys) {
    localStorage.removeItem(key);
  }
}
