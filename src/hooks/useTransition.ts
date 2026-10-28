/**
 * useTransition.ts - Smooth transition hook for animations and state changes
 * 
 * Provides:
 * - Fade transitions for UI elements
 * - Smooth value interpolation
 * - Transition state management
 * - Easing functions
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export type EasingFunction = (t: number) => number;

export interface TransitionOptions {
  duration: number; // milliseconds
  easing?: EasingFunction;
  delay?: number;
  onComplete?: () => void;
  onStart?: () => void;
}

interface TransitionState {
  isTransitioning: boolean;
  progress: number; // 0 to 1
  value: number;
}

// Easing functions
export const easings = {
  linear: (t: number): number => t,
  easeIn: (t: number): number => t * t,
  easeOut: (t: number): number => 1 - (1 - t) * (1 - t),
  easeInOut: (t: number): number => 
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t: number): number => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/**
 * Hook for smooth value transitions
 */
function useTransition(options: TransitionOptions) {
  const { duration, easing = easings.easeInOut, delay = 0, onComplete, onStart } = options;
  
  const [state, setState] = useState<TransitionState>({
    isTransitioning: false,
    progress: 0,
    value: 0,
  });

  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isActiveRef = useRef<boolean>(false);

  const start = useCallback((from: number = 0, to: number = 1) => {
    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    isActiveRef.current = true;
    startTimeRef.current = performance.now();

    setState({
      isTransitioning: true,
      progress: 0,
      value: from,
    });

    if (onStart) {
      onStart();
    }

    const animate = (currentTime: number) => {
      if (!isActiveRef.current) return;

      const elapsed = currentTime - startTimeRef.current;
      
      // Handle delay
      if (elapsed < delay) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const transitionElapsed = elapsed - delay;
      const rawProgress = Math.min(transitionElapsed / duration, 1);
      const easedProgress = easing(rawProgress);
      const currentValue = from + (to - from) * easedProgress;

      setState({
        isTransitioning: rawProgress < 1,
        progress: rawProgress,
        value: currentValue,
      });

      if (rawProgress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        isActiveRef.current = false;
        if (onComplete) {
          onComplete();
        }
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [duration, easing, delay, onComplete, onStart]);

  const stop = useCallback(() => {
    isActiveRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setState(prev => ({ ...prev, isTransitioning: false }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return {
    ...state,
    start,
    stop,
  };
}

/**
 * Hook for fade in/out transitions
 */
export function useFadeTransition(options: Omit<TransitionOptions, 'easing'> & { easing?: EasingFunction }) {
  const { start, stop, value, isTransitioning, progress } = useTransition({
    ...options,
    duration: options.duration ?? 300,
    easing: options.easing ?? easings.easeInOut,
  });

  const fadeIn = useCallback(() => {
    start(0, 1);
  }, [start]);

  const fadeOut = useCallback(() => {
    start(1, 0);
  }, [start]);

  const toggle = useCallback((show: boolean) => {
    if (show) {
      fadeIn();
    } else {
      fadeOut();
    }
  }, [fadeIn, fadeOut]);

  return {
    opacity: value,
    isTransitioning,
    progress,
    fadeIn,
    fadeOut,
    toggle,
    start,
    stop,
  };
}

