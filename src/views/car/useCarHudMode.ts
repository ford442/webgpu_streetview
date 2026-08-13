import { useCallback, useEffect, useRef, useState } from 'react';

export type CarHudMode = 'full' | 'compact' | 'immersive';

const HUD_MODE_STORAGE_KEY = 'webgpu_streetview_car_hud_mode';
const HUD_LONG_PRESS_MS = 500;

export interface UseCarHudModeResult {
  hudMode: CarHudMode;
  setHudModeAndPersist: (nextMode: CarHudMode) => void;
  toggleDashboard: () => void;
  handleHudKeyDown: () => void;
  handleHudKeyUp: () => void;
}

export interface UseCarHudModeOptions {
  isCruiseMode?: boolean;
}

export function useCarHudMode(options: UseCarHudModeOptions = {}): UseCarHudModeResult {
  const { isCruiseMode = false } = options;
  const [hudMode, setHudMode] = useState<CarHudMode>(() => {
    if (typeof window === 'undefined') return 'immersive';
    const saved = window.localStorage.getItem(HUD_MODE_STORAGE_KEY);
    if (saved === 'full' || saved === 'compact' || saved === 'immersive') return saved;
    return 'immersive';
  });
  const hudLongPressTimerRef = useRef<number | null>(null);
  const hudLongPressTriggeredRef = useRef(false);

  const setHudModeAndPersist = useCallback((nextMode: CarHudMode) => {
    setHudMode(nextMode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HUD_MODE_STORAGE_KEY, nextMode);
    }
  }, []);

  const toggleDashboard = useCallback(() => {
    setHudModeAndPersist(hudMode === 'full' ? 'compact' : 'full');
  }, [hudMode, setHudModeAndPersist]);

  const handleHudShortToggle = useCallback(() => {
    if (hudMode === 'immersive') {
      setHudModeAndPersist('compact');
      return;
    }
    setHudModeAndPersist(hudMode === 'full' ? 'compact' : 'full');
  }, [hudMode, setHudModeAndPersist]);

  const handleHudKeyDown = useCallback(() => {
    if (hudLongPressTimerRef.current !== null) return;
    hudLongPressTriggeredRef.current = false;
    hudLongPressTimerRef.current = window.setTimeout(() => {
      hudLongPressTriggeredRef.current = true;
      setHudModeAndPersist('immersive');
      hudLongPressTimerRef.current = null;
    }, HUD_LONG_PRESS_MS);
  }, [setHudModeAndPersist]);

  const handleHudKeyUp = useCallback(() => {
    if (hudLongPressTimerRef.current !== null) {
      window.clearTimeout(hudLongPressTimerRef.current);
      hudLongPressTimerRef.current = null;
    }
    if (!hudLongPressTriggeredRef.current) {
      handleHudShortToggle();
    }
    hudLongPressTriggeredRef.current = false;
  }, [handleHudShortToggle]);

  useEffect(() => () => {
    if (hudLongPressTimerRef.current !== null) {
      window.clearTimeout(hudLongPressTimerRef.current);
      hudLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isCruiseMode) {
      setHudModeAndPersist('immersive');
    }
  }, [isCruiseMode, setHudModeAndPersist]);

  return {
    hudMode,
    setHudModeAndPersist,
    toggleDashboard,
    handleHudKeyDown,
    handleHudKeyUp,
  };
}
