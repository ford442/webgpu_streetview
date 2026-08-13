import { useCallback, useEffect, useState } from 'react';

export interface CinemaModeState {
  isCinemaMode: boolean;
  letterbox: boolean;
  /** Lock exposure/grading sliders from accidental changes while filming. */
  gradingLocked: boolean;
  toggleCinemaMode: () => void;
  enterCinemaMode: () => void;
  exitCinemaMode: () => void;
  setLetterbox: (enabled: boolean) => void;
  setGradingLocked: (locked: boolean) => void;
}

/**
 * Immersive cinema mode — hides chrome, optional letterbox, Esc to exit.
 * Does not touch rear-view Static feed (billing gate unchanged).
 */
export function useCinemaMode(enabled: boolean): CinemaModeState {
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [letterbox, setLetterbox] = useState(true);
  const [gradingLocked, setGradingLocked] = useState(false);

  const enterCinemaMode = useCallback(() => setIsCinemaMode(true), []);
  const exitCinemaMode = useCallback(() => setIsCinemaMode(false), []);
  const toggleCinemaMode = useCallback(() => setIsCinemaMode((v) => !v), []);

  // Esc exits cinema mode (global listener only while active).
  useEffect(() => {
    if (!enabled || !isCinemaMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        exitCinemaMode();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, isCinemaMode, exitCinemaMode]);

  // Body class for global CSS hooks (letterbox, hide scrollbars).
  useEffect(() => {
    if (!enabled) return;
    document.body.classList.toggle('cinema-mode', isCinemaMode);
    return () => document.body.classList.remove('cinema-mode');
  }, [enabled, isCinemaMode]);

  return {
    isCinemaMode,
    letterbox,
    gradingLocked,
    toggleCinemaMode,
    enterCinemaMode,
    exitCinemaMode,
    setLetterbox,
    setGradingLocked,
  };
}
