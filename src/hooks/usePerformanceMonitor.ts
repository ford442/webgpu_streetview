/** @fileoverview Performance monitoring hook for FPS tracking and adaptive quality */
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// Types
// ============================================================

export interface FPSStats {
  current: number;
  average: number;
  min: number;
  max: number;
  frameTime: number; // ms
}

export interface PerformanceMonitorConfig {
  targetFPS: number;
  sampleSize: number;
  warningThreshold: number; // FPS below this triggers warning
  criticalThreshold: number; // FPS below this triggers quality reduction
  enableAdaptiveQuality: boolean;
}

export interface PerformanceMonitorState {
  fps: FPSStats;
  quality: 'high' | 'medium' | 'low';
  isMonitoring: boolean;
  droppedFrames: number;
}

export interface UsePerformanceMonitorReturn {
  stats: PerformanceMonitorState;
  startMonitoring: () => void;
  stopMonitoring: () => void;
  resetStats: () => void;
  shouldSkipFrame: () => boolean;
  getAdaptiveDelta: () => number;
}

// ============================================================
// Hook Implementation
// ============================================================

const DEFAULT_CONFIG: PerformanceMonitorConfig = {
  targetFPS: 60,
  sampleSize: 60,
  warningThreshold: 45,
  criticalThreshold: 30,
  enableAdaptiveQuality: true
};

/**
 * React hook for monitoring rendering performance
 * Tracks FPS, frame times, and provides adaptive quality control
 */
export function usePerformanceMonitor(
  config?: Partial<PerformanceMonitorConfig>
): UsePerformanceMonitorReturn {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Refs for tracking (don't trigger re-renders)
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const isMonitoringRef = useRef<boolean>(false);
  const frameSkipRef = useRef<number>(0);
  const adaptiveDeltaRef = useRef<number>(1);
  const droppedFramesRef = useRef<number>(0);
  
  // State for React components
  const [state, setState] = useState<PerformanceMonitorState>({
    fps: {
      current: 60,
      average: 60,
      min: 60,
      max: 60,
      frameTime: 16.67
    },
    quality: 'high',
    isMonitoring: false,
    droppedFrames: 0
  });
  
  /**
   * Calculate FPS from frame times
   */
  const calculateFPS = useCallback((): FPSStats => {
    const times = frameTimesRef.current;
    if (times.length === 0) {
      return {
        current: fullConfig.targetFPS,
        average: fullConfig.targetFPS,
        min: fullConfig.targetFPS,
        max: fullConfig.targetFPS,
        frameTime: 1000 / fullConfig.targetFPS
      };
    }
    
    const current = times[times.length - 1];
    const average = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const frameTime = 1000 / (average || fullConfig.targetFPS);
    
    return {
      current: Math.round(current),
      average: Math.round(average),
      min: Math.round(min),
      max: Math.round(max),
      frameTime: Math.round(frameTime * 100) / 100
    };
  }, [fullConfig.targetFPS]);
  
  /**
   * Update quality level based on performance
   */
  const updateQuality = useCallback((fps: number): 'high' | 'medium' | 'low' => {
    if (!fullConfig.enableAdaptiveQuality) return 'high';
    
    if (fps < fullConfig.criticalThreshold) {
      return 'low';
    } else if (fps < fullConfig.warningThreshold) {
      return 'medium';
    }
    return 'high';
  }, [fullConfig.criticalThreshold, fullConfig.warningThreshold, fullConfig.enableAdaptiveQuality]);
  
  /**
   * Main monitoring loop
   */
  const tick = useCallback(() => {
    if (!isMonitoringRef.current) return;
    
    const now = performance.now();
    const delta = lastFrameTimeRef.current ? now - lastFrameTimeRef.current : 16.67;
    lastFrameTimeRef.current = now;
    
    // Calculate instantaneous FPS
    const instantFPS = 1000 / (delta || 16.67);
    
    // Track frame times
    frameTimesRef.current.push(instantFPS);
    if (frameTimesRef.current.length > fullConfig.sampleSize) {
      frameTimesRef.current.shift();
    }
    
    // Count dropped frames (frames that took longer than target)
    const targetFrameTime = 1000 / fullConfig.targetFPS;
    if (delta > targetFrameTime * 1.5) {
      droppedFramesRef.current++;
    }
    
    // Calculate adaptive delta (slow down time in low FPS scenarios)
    const targetDelta = 1000 / fullConfig.targetFPS;
    adaptiveDeltaRef.current = Math.min(delta / targetDelta, 2); // Cap at 2x slowdown
    
    frameCountRef.current++;
    
    // Update state periodically (every 10 frames)
    if (frameCountRef.current % 10 === 0) {
      const fps = calculateFPS();
      const newQuality = updateQuality(fps.current);
      
      setState(prev => ({
        ...prev,
        fps,
        quality: newQuality,
        droppedFrames: droppedFramesRef.current
      }));
    }
    
    // Adjust frame skipping based on quality
    switch (state.quality) {
      case 'low':
        frameSkipRef.current = 1; // Skip every other frame
        break;
      case 'medium':
        frameSkipRef.current = 0; // No skipping
        break;
      case 'high':
        frameSkipRef.current = 0; // No skipping
        break;
    }
    
    animationFrameRef.current = requestAnimationFrame(tick);
  }, [calculateFPS, fullConfig.sampleSize, fullConfig.targetFPS, state.quality, updateQuality]);
  
  /**
   * Start monitoring
   */
  const startMonitoring = useCallback(() => {
    if (isMonitoringRef.current) return;
    
    isMonitoringRef.current = true;
    lastFrameTimeRef.current = performance.now();
    setState(prev => ({ ...prev, isMonitoring: true }));
    
    animationFrameRef.current = requestAnimationFrame(tick);
  }, [tick]);
  
  /**
   * Stop monitoring
   */
  const stopMonitoring = useCallback(() => {
    isMonitoringRef.current = false;
    setState(prev => ({ ...prev, isMonitoring: false }));
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);
  
  /**
   * Reset all stats
   */
  const resetStats = useCallback(() => {
    frameTimesRef.current = [];
    lastFrameTimeRef.current = 0;
    frameCountRef.current = 0;
    frameSkipRef.current = 0;
    droppedFramesRef.current = 0;
    
    setState({
      fps: {
        current: fullConfig.targetFPS,
        average: fullConfig.targetFPS,
        min: fullConfig.targetFPS,
        max: fullConfig.targetFPS,
        frameTime: 1000 / fullConfig.targetFPS
      },
      quality: 'high',
      isMonitoring: state.isMonitoring,
      droppedFrames: 0
    });
  }, [fullConfig.targetFPS, state.isMonitoring]);
  
  /**
   * Check if current frame should be skipped
   */
  const shouldSkipFrame = useCallback((): boolean => {
    if (frameSkipRef.current === 0) return false;
    return frameCountRef.current % (frameSkipRef.current + 1) !== 0;
  }, []);
  
  /**
   * Get adaptive delta for time-based animations
   */
  const getAdaptiveDelta = useCallback((): number => {
    return adaptiveDeltaRef.current;
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  return {
    stats: state,
    startMonitoring,
    stopMonitoring,
    resetStats,
    shouldSkipFrame,
    getAdaptiveDelta
  };
}

// ============================================================
// Performance Stats Overlay Component
// ============================================================

export interface PerformanceOverlayProps {
  stats: PerformanceMonitorState;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  showGraph?: boolean;
  visible?: boolean;
}

/**
 * Get CSS styles for the performance overlay
 */
export function getPerformanceOverlayStyles(
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'top-left'
): React.CSSProperties {
  const baseStyles: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '10px',
    borderRadius: '4px',
    pointerEvents: 'none',
    userSelect: 'none',
    minWidth: '150px'
  };
  
  switch (position) {
    case 'top-left':
      return { ...baseStyles, top: '10px', left: '10px' };
    case 'top-right':
      return { ...baseStyles, top: '10px', right: '10px' };
    case 'bottom-left':
      return { ...baseStyles, bottom: '10px', left: '10px' };
    case 'bottom-right':
      return { ...baseStyles, bottom: '10px', right: '10px' };
    default:
      return baseStyles;
  }
}

/**
 * Get color based on FPS value
 */
export function getFPSColor(fps: number, targetFPS: number = 60): string {
  const ratio = fps / targetFPS;
  if (ratio >= 0.9) return '#00ff00'; // Green
  if (ratio >= 0.7) return '#ffff00'; // Yellow
  if (ratio >= 0.5) return '#ff8800'; // Orange
  return '#ff0000'; // Red
}

/**
 * Format performance stats for display
 */
export function formatPerformanceStats(stats: PerformanceMonitorState): string {
  const { fps, quality, droppedFrames } = stats;
  return [
    `FPS: ${fps.current} [${fps.min}-${fps.max}]`,
    `Avg: ${fps.average} | Frame: ${fps.frameTime.toFixed(2)}ms`,
    `Quality: ${quality.toUpperCase()}`,
    `Dropped: ${droppedFrames}`
  ].join('\n');
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Create a performance mark for profiling
 */
export function markPerformance(label: string): void {
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(label);
  }
}

/**
 * Measure time between two marks
 */
export function measurePerformance(name: string, startLabel: string, endLabel: string): number {
  if (typeof performance !== 'undefined' && performance.measure) {
    try {
      performance.measure(name, startLabel, endLabel);
      const entries = performance.getEntriesByName(name);
      return entries[entries.length - 1]?.duration || 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Throttle a function to maintain target FPS
 */
export function throttleToFPS<T extends (...args: any[]) => void>(
  fn: T,
  targetFPS: number
): T {
  let lastCall = 0;
  const minInterval = 1000 / targetFPS;
  
  return ((...args: Parameters<T>) => {
    const now = performance.now();
    if (now - lastCall >= minInterval) {
      lastCall = now;
      fn(...args);
    }
  }) as T;
}

/**
 * Debounce frame updates for non-critical operations
 */
export function debounceFrame<T extends (...args: any[]) => void>(
  fn: T,
  frames: number = 1
): T {
  let frameCount = 0;
  let pendingArgs: Parameters<T> | null = null;
  
  return ((...args: Parameters<T>) => {
    pendingArgs = args;
    
    const tick = () => {
      frameCount++;
      if (frameCount >= frames) {
        if (pendingArgs) {
          fn(...pendingArgs);
          pendingArgs = null;
        }
        frameCount = 0;
      } else {
        requestAnimationFrame(tick);
      }
    };
    
    requestAnimationFrame(tick);
  }) as T;
}

// ============================================================
// Browser Performance API Integration
// ============================================================

/**
 * Check if the browser supports performance observer
 */
export function supportsPerformanceObserver(): boolean {
  return typeof PerformanceObserver !== 'undefined';
}

/**
 * Create a performance observer for long tasks
 */
export function createLongTaskObserver(
  callback: (entries: PerformanceEntryList) => void
): PerformanceObserver | null {
  if (!supportsPerformanceObserver()) return null;
  
  try {
    const observer = new PerformanceObserver((list) => {
      callback(list.getEntries());
    });
    observer.observe({ entryTypes: ['longtask'] });
    return observer;
  } catch {
    return null;
  }
}

// Cache structure for navigation timing
interface NavigationCache {
  value: PerformanceNavigationTiming | null;
  timestamp: number;
  isResolved: boolean;
}

const NAVIGATION_RETRY_MS = 5000; // 5 seconds after page load

// Internal cache for navigation timing (static after load)
let navigationTimingCache: NavigationCache | null = null;

/**
 * Get navigation timing information
 * Optimized to cache both positive results and negative results (after a retry window).
 */
export function getNavigationTiming(): Partial<PerformanceNavigationTiming> | null {
  if (typeof performance === 'undefined') return null;
  
  let startMark = 0;
  if (process.env.NODE_ENV === 'development') {
    startMark = performance.now();
  }

  // Fast path: fully resolved cache
  if (navigationTimingCache?.isResolved) {
    if (process.env.NODE_ENV === 'development') {
      const duration = performance.now() - startMark;
      console.log(`[usePerformanceMonitor] getNavigationTiming (cache hit) took ${duration.toFixed(4)}ms`);
    }
    return navigationTimingCache.value;
  }

  const currentNow = performance.now();
  const entries = performance.getEntriesByType('navigation');

  if (entries.length > 0) {
    // We found the entry, cache it permanently
    navigationTimingCache = {
      value: entries[0] as PerformanceNavigationTiming,
      timestamp: currentNow,
      isResolved: true
    };
  } else if (currentNow > NAVIGATION_RETRY_MS) {
    // No entry found and we are past the retry window, cache negative result permanently
    navigationTimingCache = {
      value: null,
      timestamp: currentNow,
      isResolved: true
    };
  }
  // If we get empty but are still inside retry window, we do nothing and allow future calls

  if (process.env.NODE_ENV === 'development') {
    const duration = performance.now() - startMark;
    const cacheStatus = navigationTimingCache?.isResolved ? 'resolved' : 'retrying';
    console.log(`[usePerformanceMonitor] getNavigationTiming (API call, ${cacheStatus}) took ${duration.toFixed(4)}ms`);
  }

  return navigationTimingCache?.value || null;
}
