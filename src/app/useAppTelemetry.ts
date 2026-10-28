import { useState, useEffect } from 'react';
import { getMemoryProfiler, type MemoryStats } from '../utils/memoryProfiler';
import {
  getGpuPassTimings,
  setGpuPassTimingsWanted,
  type GpuPassTimings,
} from '../renderer/gpuPassTimingStore';
import { getGpuChoresStats, type GpuChoresStats } from '../renderer/gpuChores/gpuChoresStatsStore';
import { getAutoExposureStatus, type AutoExposureStatus } from '../renderer/autoExposure';
import { getAppliedRenderScale, type AppliedRenderScale } from '../renderer/renderScale';

export interface AppTelemetry {
  memoryStats: MemoryStats | null;
  gpuPassTimings: GpuPassTimings;
  gpuChoresStats: GpuChoresStats;
  autoExposureStatus: AutoExposureStatus;
  renderScale: AppliedRenderScale;
}

/**
 * What the performance overlay shows besides frame rate (which it reads from
 * `perfStore`): memory, GPU pass timings, chores, exposure, render scale.
 * Sampled at 1 Hz, and GPU timestamp queries run, only while the overlay
 * calling it is mounted.
 */
export function useAppTelemetry(): AppTelemetry {
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [gpuPassTimings, setGpuPassTimingsState] = useState<GpuPassTimings>(() => getGpuPassTimings());
  const [gpuChoresStats, setGpuChoresStatsState] = useState<GpuChoresStats>(() => getGpuChoresStats());
  const [autoExposureStatus, setAutoExposureStatusState] = useState<AutoExposureStatus>(
    () => getAutoExposureStatus(),
  );
  const [renderScale, setRenderScaleState] = useState<AppliedRenderScale>(
    () => ({ ...getAppliedRenderScale() }),
  );

  // GPU timestamp queries run only while the overlay is open to read them.
  useEffect(() => {
    setGpuPassTimingsWanted(true);
    return () => setGpuPassTimingsWanted(false);
  }, []);

  // Frame rate comes from `perfStore`, which the overlay reads itself.
  useEffect(() => {
    const memoryProfiler = getMemoryProfiler();
    const interval = setInterval(() => {
      memoryProfiler.snapshot();
      setMemoryStats(memoryProfiler.getStats());
      setGpuPassTimingsState(getGpuPassTimings());
      setGpuChoresStatsState({ ...getGpuChoresStats() });
      setAutoExposureStatusState({ ...getAutoExposureStatus() });
      setRenderScaleState({ ...getAppliedRenderScale() });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return {
    memoryStats,
    gpuPassTimings,
    gpuChoresStats,
    autoExposureStatus,
    renderScale,
  };
}
