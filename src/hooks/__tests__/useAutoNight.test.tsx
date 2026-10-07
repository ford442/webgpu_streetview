import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoNight, AUTO_NIGHT_RECOMPUTE_MS } from '../useAutoNight';
import type { AutoNightSample } from '../../utils/autoNightModel';

const coords = { lat: 0, lng: 0 };

describe('useAutoNight', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports the sun angle for the injected clock and eases night intensity toward it', () => {
    const onNight = vi.fn();
    const onSunMoon = vi.fn<(s: AutoNightSample) => void>();
    const clock = new Date(Date.UTC(2024, 2, 20, 0, 0, 0)); // midnight at 0°E

    renderHook(() => useAutoNight(coords, true, 0, onNight, onSunMoon, () => clock));

    expect(onSunMoon).toHaveBeenCalledTimes(1);
    expect(onSunMoon.mock.calls[0]![0].sunAltitude).toBeLessThan(0);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(onNight).toHaveBeenCalled();
    const last = onNight.mock.calls.at(-1)![0] as number;
    expect(last).toBeGreaterThan(0);
  });

  it('sun angle follows the clock across recomputes', () => {
    const onSunMoon = vi.fn<(s: AutoNightSample) => void>();
    let now = new Date(Date.UTC(2024, 2, 20, 11, 0, 0));
    renderHook(() => useAutoNight(coords, true, 0, vi.fn(), onSunMoon, () => now));

    const before = onSunMoon.mock.calls.at(-1)![0].sunAltitude;
    now = new Date(Date.UTC(2024, 2, 20, 18, 0, 0));
    act(() => { vi.advanceTimersByTime(AUTO_NIGHT_RECOMPUTE_MS); });
    const after = onSunMoon.mock.calls.at(-1)![0].sunAltitude;

    expect(after).toBeLessThan(before - 0.5);
  });

  it('does nothing when disabled or without coordinates', () => {
    const onNight = vi.fn();
    const onSunMoon = vi.fn();
    renderHook(() => useAutoNight(coords, false, 0, onNight, onSunMoon));
    renderHook(() => useAutoNight(null, true, 0, onNight, onSunMoon));
    act(() => { vi.advanceTimersByTime(AUTO_NIGHT_RECOMPUTE_MS * 2); });
    expect(onNight).not.toHaveBeenCalled();
    expect(onSunMoon).not.toHaveBeenCalled();
  });

  it('stops ticking after unmount', () => {
    const onSunMoon = vi.fn();
    const { unmount } = renderHook(() => useAutoNight(coords, true, 0, vi.fn(), onSunMoon));
    unmount();
    onSunMoon.mockClear();
    act(() => { vi.advanceTimersByTime(AUTO_NIGHT_RECOMPUTE_MS * 3); });
    expect(onSunMoon).not.toHaveBeenCalled();
  });
});
