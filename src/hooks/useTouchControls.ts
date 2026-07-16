import { useCallback, useEffect, useRef, useState } from 'react';

export interface TouchGestureState {
  isDragging: boolean;
  isPinching: boolean;
  lastTouchX: number;
  lastTouchY: number;
  touchStartDistance: number;
  pinchStartZoom: number;
  velocityX: number;
  velocityY: number;
}

export interface UseTouchControlsOptions {
  enabled?: boolean;
  onPan?: (deltaX: number, deltaY: number) => void;
  onZoom?: (zoomDelta: number) => void;
  onDoubleTap?: () => void;
  onTap?: () => void;
  panSensitivity?: number;
  zoomSensitivity?: number;
  doubleTapDelay?: number;
}

export interface UseTouchControlsReturn {
  gestureState: TouchGestureState;
  bindTouchEvents: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchCancel: (e: React.TouchEvent) => void;
  };
}

/**
 * Hook for handling touch gestures on mobile devices
 * - Single finger drag: Pan/look around
 * - Two finger pinch: Zoom in/out
 * - Double tap: Interact/activate
 */
export function useTouchControls(options: UseTouchControlsOptions = {}): UseTouchControlsReturn {
  const {
    enabled = true,
    onPan,
    onZoom,
    onDoubleTap,
    onTap,
    panSensitivity = 0.5,
    zoomSensitivity = 1.0,
    doubleTapDelay = 300,
  } = options;

  const [gestureState, setGestureState] = useState<TouchGestureState>({
    isDragging: false,
    isPinching: false,
    lastTouchX: 0,
    lastTouchY: 0,
    touchStartDistance: 0,
    pinchStartZoom: 1,
    velocityX: 0,
    velocityY: 0,
  });

  // Refs for tracking state without re-renders
  const touchStartTimeRef = useRef<number>(0);
  const lastTapTimeRef = useRef<number>(0);
  const initialTouchRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const velocityRef = useRef({ x: 0, y: 0 });

  /**
   * Calculate distance between two touch points
   */
  const getTouchDistance = useCallback((touch1: { clientX: number; clientY: number }, touch2: { clientX: number; clientY: number }): number => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  /**
   * Calculate midpoint between two touch points
   */
  const getTouchMidpoint = useCallback((touch1: { clientX: number; clientY: number }, touch2: { clientX: number; clientY: number }): { x: number; y: number } => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  }, []);

  /**
   * Handle touch start
   */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;

      e.preventDefault();
      touchStartTimeRef.current = Date.now();
      const touches = e.touches;

      if (touches.length === 1) {
        // Single finger - start drag
        const t0 = touches[0]!;
        initialTouchRef.current = { x: t0.clientX, y: t0.clientY };
        setGestureState((prev) => ({
          ...prev,
          isDragging: true,
          isPinching: false,
          lastTouchX: t0.clientX,
          lastTouchY: t0.clientY,
          velocityX: 0,
          velocityY: 0,
        }));
        velocityRef.current = { x: 0, y: 0 };
      } else if (touches.length === 2) {
        // Two fingers - start pinch
        const distance = getTouchDistance(touches[0]!, touches[1]!);
        initialTouchRef.current = getTouchMidpoint(touches[0]!, touches[1]!);
        setGestureState((prev) => ({
          ...prev,
          isDragging: false,
          isPinching: true,
          touchStartDistance: distance,
          velocityX: 0,
          velocityY: 0,
        }));
      }
    },
    [enabled, getTouchDistance, getTouchMidpoint]
  );

  /**
   * Handle touch move
   */
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;

      e.preventDefault();
      const touches = e.touches;

      if (touches.length === 1 && gestureState.isDragging) {
        // Single finger drag - pan
        const t0 = touches[0]!;
        const deltaX = (t0.clientX - gestureState.lastTouchX) * panSensitivity;
        const deltaY = (t0.clientY - gestureState.lastTouchY) * panSensitivity;

        // Calculate velocity for momentum scrolling
        velocityRef.current = {
          x: deltaX * 0.3,
          y: deltaY * 0.3,
        };

        setGestureState((prev) => ({
          ...prev,
          lastTouchX: t0.clientX,
          lastTouchY: t0.clientY,
          velocityX: velocityRef.current.x,
          velocityY: velocityRef.current.y,
        }));

        onPan?.(deltaX, deltaY);
      } else if (touches.length === 2 && gestureState.isPinching) {
        // Two finger pinch - zoom
        const currentDistance = getTouchDistance(touches[0]!, touches[1]!);
        const pinchRatio = currentDistance / gestureState.touchStartDistance;
        const zoomDelta = (pinchRatio - 1) * 100 * zoomSensitivity;

        onZoom?.(zoomDelta);

        // Update midpoint for reference
        const midpoint = getTouchMidpoint(touches[0]!, touches[1]!);
        setGestureState((prev) => ({
          ...prev,
          lastTouchX: midpoint.x,
          lastTouchY: midpoint.y,
        }));
      }
    },
    [enabled, gestureState, panSensitivity, zoomSensitivity, onPan, onZoom, getTouchDistance, getTouchMidpoint]
  );

  /**
   * Apply momentum scrolling after drag ends
   */
  const applyMomentum = useCallback(() => {
    if (Math.abs(velocityRef.current.x) < 0.1 && Math.abs(velocityRef.current.y) < 0.1) {
      return;
    }

    onPan?.(velocityRef.current.x, velocityRef.current.y);

    // Decay velocity
    velocityRef.current.x *= 0.95;
    velocityRef.current.y *= 0.95;

    rafIdRef.current = requestAnimationFrame(applyMomentum);
  }, [onPan]);

  /**
   * Handle touch end
   */
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;

      const touchEndTime = Date.now();
      const touchDuration = touchEndTime - touchStartTimeRef.current;

      // Cancel any pending momentum
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      // Check for tap (quick touch with minimal movement)
      if (e.changedTouches.length === 1 && touchDuration < 200 && initialTouchRef.current) {
        const touch = e.changedTouches[0]!;
        const moveDistance = Math.sqrt(
          Math.pow(touch.clientX - initialTouchRef.current.x, 2) +
          Math.pow(touch.clientY - initialTouchRef.current.y, 2)
        );

        if (moveDistance < 10) {
          // This is a tap
          const now = Date.now();
          if (now - lastTapTimeRef.current < doubleTapDelay) {
            // Double tap detected
            onDoubleTap?.();
            lastTapTimeRef.current = 0; // Reset
          } else {
            // Single tap
            onTap?.();
            lastTapTimeRef.current = now;
          }
        }
      }

      // Apply momentum scrolling after drag
      if (gestureState.isDragging && (Math.abs(velocityRef.current.x) > 1 || Math.abs(velocityRef.current.y) > 1)) {
        rafIdRef.current = requestAnimationFrame(applyMomentum);
      }

      // Reset state
      setGestureState((prev) => ({
        ...prev,
        isDragging: false,
        isPinching: false,
        velocityX: 0,
        velocityY: 0,
      }));
      initialTouchRef.current = null;
    },
    [enabled, gestureState.isDragging, doubleTapDelay, onDoubleTap, onTap, applyMomentum]
  );

  /**
   * Handle touch cancel
   */
  const handleTouchCancel = useCallback(
    (_e: React.TouchEvent) => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      setGestureState((prev) => ({
        ...prev,
        isDragging: false,
        isPinching: false,
        velocityX: 0,
        velocityY: 0,
      }));
      initialTouchRef.current = null;
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return {
    gestureState,
    bindTouchEvents: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchCancel,
    },
  };
}

export default useTouchControls;
