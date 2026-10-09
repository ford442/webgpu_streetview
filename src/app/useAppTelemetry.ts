import { useState, useEffect } from 'react';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';
import { getMemoryProfiler, type MemoryStats } from '../utils/memoryProfiler';
import {
  getGpuPassTimings,
  setGpuPassTimingsWanted,
  type GpuPassTimings,
} from '../renderer/gpuPassTimingStore';
import { getGpuChoresStats, type GpuChoresStats } from '../renderer/gpuChores/gpuChoresStatsStore';
import { getAutoExposureStatus, type AutoExposureStatus } from '../renderer/autoExposure';

export interface AppTelemetry {
  showPerformanceStats: boolean;
  setShowPerformanceStats: (show: boolean) => void;
  memoryStats: MemoryStats | null;
  perfStats: ReturnType<typeof usePerformanceMonitor>['stats'];
  gpuPassTimings: GpuPassTimings;
  gpuChoresStats: GpuChoresStats;
  autoExposureStatus: AutoExposureStatus;
}

/** Performance overlay + memory profiler sampling for the stats panel. */
export function useAppTelemetry(): AppTelemetry {
  const [showPerformanceStats, setShowPerformanceStats] = useState(false);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [gpuPassTimings, setGpuPassTimingsState] = useState<GpuPassTimings>(() => getGpuPassTimings());
  const [gpuChoresStats, setGpuChoresStatsState] = useState<GpuChoresStats>(() => getGpuChoresStats());
  const [autoExposureStatus, setAutoExposureStatusState] = useState<AutoExposureStatus>(
    () => getAutoExposureStatus(),
  );
  const { stats: perfStats } = usePerformanceMonitor({
    targetFPS: 60,
    sampleSize: 60,
    warningThreshold: 45,
    criticalThreshold: 30,
    enableAdaptiveQuality: true,
  });

  // GPU timestamp queries run only while the overlay is open to read them.
  useEffect(() => {
    setGpuPassTimingsWanted(showPerformanceStats);
    return () => setGpuPassTimingsWanted(false);
  }, [showPerformanceStats]);

  useEffect(() => {
    if (!showPerformanceStats) return;
    const memoryProfiler = getMemoryProfiler();
    const interval = setInterval(() => {
      memoryProfiler.snapshot();
      setMemoryStats(memoryProfiler.getStats());
      setGpuPassTimingsState(getGpuPassTimings());
      setGpuChoresStatsState({ ...getGpuChoresStats() });
      setAutoExposureStatusState({ ...getAutoExposureStatus() });
    }, 1000);
    return () => clearInterval(interval);
  }, [showPerformanceStats]);

  return {
    showPerformanceStats,
    setShowPerformanceStats,
    memoryStats,
    perfStats,
    gpuPassTimings,
    gpuChoresStats,
    autoExposureStatus,
  };
}
