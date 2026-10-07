import type { GpuChoresBackend } from './gpuChoresPolicy';

export interface GpuChoresStats {
  backend: GpuChoresBackend | 'disabled';
  killSwitch: boolean;
  meanLuma: number | null;
  minLuma: number | null;
  maxLuma: number | null;
  sampleMs: number | null;
  /**
   * Per-row mean luma (top-origin) for the horizon estimate
   * (horizonEstimate.ts). Only sampled while a preset blend weight is > 0.
   */
  rowLuma: Float32Array | null;
  /** Normalized camera pitch the rows were sampled at. */
  rowLumaPitch: number | null;
  /** Bumped on every published row set. */
  rowLumaSeq: number;
  lastUpdated: number;
}

const INITIAL: GpuChoresStats = {
  backend: 'disabled',
  killSwitch: false,
  meanLuma: null,
  minLuma: null,
  maxLuma: null,
  sampleMs: null,
  rowLuma: null,
  rowLumaPitch: null,
  rowLumaSeq: 0,
  lastUpdated: 0,
};

let current: GpuChoresStats = { ...INITIAL };

export function getGpuChoresStats(): GpuChoresStats {
  return current;
}

export function setGpuChoresStats(next: Partial<GpuChoresStats>): void {
  current = { ...current, ...next, lastUpdated: Date.now() };
  publishGpuChoresBreadcrumbs();
}

export function publishHorizonRows(rows: Float32Array, pitch: number): void {
  current = {
    ...current,
    rowLuma: rows,
    rowLumaPitch: pitch,
    rowLumaSeq: current.rowLumaSeq + 1,
    lastUpdated: Date.now(),
  };
}

export function resetGpuChoresStats(): void {
  current = { ...INITIAL };
  publishGpuChoresBreadcrumbs();
}

export interface GpuChoresBreadcrumbs {
  backend: GpuChoresStats['backend'];
  killSwitch: boolean;
  jobs: readonly ['luma_histogram_bt709', 'downsample_2d', 'reduce'];
  last: {
    meanLuma: number | null;
    minLuma: number | null;
    maxLuma: number | null;
    sampleMs: number | null;
    updatedAt: number;
  };
}

export function publishGpuChoresBreadcrumbs(): GpuChoresBreadcrumbs {
  const crumbs: GpuChoresBreadcrumbs = {
    backend: current.backend,
    killSwitch: current.killSwitch,
    jobs: ['luma_histogram_bt709', 'downsample_2d', 'reduce'],
    last: {
      meanLuma: current.meanLuma,
      minLuma: current.minLuma,
      maxLuma: current.maxLuma,
      sampleMs: current.sampleMs,
      updatedAt: current.lastUpdated,
    },
  };
  if (typeof window !== 'undefined') {
    (window as Window & { __GPU_CHORES__?: GpuChoresBreadcrumbs }).__GPU_CHORES__ = crumbs;
  }
  return crumbs;
}
