import { formatBytes, summarizeStorageEstimate } from './storageEstimate';

describe('storageEstimate', () => {
  it('formats bytes across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('summarizes usage percentage capped at 100', () => {
    const summary = summarizeStorageEstimate(512 * 1024 * 1024, 1024 * 1024 * 1024);
    expect(summary.percentUsed).toBeCloseTo(50, 1);
    expect(summary.usageLabel).toMatch(/MB/);
    expect(summary.quotaLabel).toMatch(/GB/);
  });

  it('handles missing quota gracefully', () => {
    const summary = summarizeStorageEstimate(0, 0);
    expect(summary.percentUsed).toBe(0);
  });
});
