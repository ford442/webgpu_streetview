export interface StorageEstimateSummary {
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
  usageLabel: string;
  quotaLabel: string;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function summarizeStorageEstimate(usage = 0, quota = 0): StorageEstimateSummary {
  const usageBytes = Math.max(0, usage);
  const quotaBytes = Math.max(0, quota);
  const percentUsed = quotaBytes > 0 ? Math.min(100, (usageBytes / quotaBytes) * 100) : 0;
  return {
    usageBytes,
    quotaBytes,
    percentUsed,
    usageLabel: formatBytes(usageBytes),
    quotaLabel: formatBytes(quotaBytes),
  };
}

export async function readStorageEstimate(): Promise<StorageEstimateSummary> {
  if (!navigator.storage?.estimate) {
    return summarizeStorageEstimate(0, 0);
  }
  const estimate = await navigator.storage.estimate();
  return summarizeStorageEstimate(estimate.usage ?? 0, estimate.quota ?? 0);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
