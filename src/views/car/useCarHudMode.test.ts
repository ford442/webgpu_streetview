import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCarHudMode } from './useCarHudMode';

describe('useCarHudMode', () => {
  it('defaults to immersive when nothing is stored', () => {
    window.localStorage.removeItem('webgpu_streetview_car_hud_mode');
    const { result } = renderHook(() => useCarHudMode());
    expect(result.current.hudMode).toBe('immersive');
  });

  it('switches to immersive when cruise engages from full HUD', () => {
    window.localStorage.setItem('webgpu_streetview_car_hud_mode', 'full');
    const { result, rerender } = renderHook(
      ({ cruise }: { cruise: boolean }) => useCarHudMode({ isCruiseMode: cruise }),
      { initialProps: { cruise: false } },
    );
    expect(result.current.hudMode).toBe('full');
    act(() => {
      rerender({ cruise: true });
    });
    expect(result.current.hudMode).toBe('immersive');
  });
});
