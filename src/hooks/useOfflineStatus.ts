import { useState, useEffect } from 'react';
import { readStorageEstimate, type StorageEstimateSummary } from '../offline/storageEstimate';

export interface OfflineStatus {
  isOnline: boolean;
  hasServiceWorker: boolean;
  storage: StorageEstimateSummary | null;
  refreshStorage: () => Promise<void>;
}

/** Tracks network connectivity and storage quota for offline UI. */
export function useOfflineStatus(pollMs = 5000): OfflineStatus {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [hasServiceWorker, setHasServiceWorker] = useState(false);
  const [storage, setStorage] = useState<StorageEstimateSummary | null>(null);

  const refreshStorage = async () => {
    const estimate = await readStorageEstimate();
    setStorage(estimate);
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setHasServiceWorker('serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller));
    void refreshStorage();
    const interval = setInterval(() => void refreshStorage(), pollMs);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [pollMs]);

  return { isOnline, hasServiceWorker, storage, refreshStorage };
}
