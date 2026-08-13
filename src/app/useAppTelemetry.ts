import { useState, useEffect } from 'react';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';
import { getMemoryProfiler, type MemoryStats } from '../utils/memoryProfiler';
import { getGpuPassTimings, type GpuPassTimings } from '../renderer/gpuPassTimingStore';

export interface AppTelemetry {
  showPerformanceStats: boolean;
  setShowPerformanceStats: (show: boolean) => void;
  memoryStats: MemoryStats | null;
  perfStats: ReturnType<typeof usePerformanceMonitor>['stats'];
  gpuPassTimings: GpuPassTimings;
}

/** Performance overlay + memory profiler sampling for the stats panel. */
export function useAppTelemetry(): AppTelemetry {
  const [showPerformanceStats, setShowPerformanceStats] = useState(false);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [gpuPassTimings, setGpuPassTimingsState] = useState<GpuPassTimings>(() => getGpuPassTimings());
  const { stats: perfStats } = usePerformanceMonitor({
    targetFPS: 60,
    sampleSize: 60,
    warningThreshold: 45,
    criticalThreshold: 30,
    enableAdaptiveQuality: true,
  });

  useEffect(() => {
    if (!showPerformanceStats) return;
    const memoryProfiler = getMemoryProfiler();
    const interval = setInterval(() => {
      memoryProfiler.snapshot();
      setMemoryStats(memoryProfiler.getStats());
      setGpuPassTimingsState(getGpuPassTimings());
    }, 1000);
    return () => clearInterval(interval);
  }, [showPerformanceStats]);

  return {
    showPerformanceStats,
    setShowPerformanceStats,
    memoryStats,
    perfStats,
    gpuPassTimings,
  };
}
