// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppPanels, usePanelsSnapshot } from './useAppPanels';
import { isPanelOpen, resetPanelsForTests } from '../state/panelsStore';

beforeEach(() => resetPanelsForTests());

describe('useAppPanels', () => {
  it('is one stable live view: flags read the store at call time', () => {
    const { result, rerender } = renderHook(() => useAppPanels());
    const first = result.current;
    expect(first.isWeatherPanelOpen).toBe(false);
    act(() => first.setIsWeatherPanelOpen(true));
    expect(first.isWeatherPanelOpen).toBe(true);
    expect(isPanelOpen('weather')).toBe(true);
    rerender();
    expect(result.current).toBe(first);
  });

  it('a spread of the live view is a snapshot (why the shortcuts use usePanelsSnapshot)', () => {
    const live = renderHook(() => useAppPanels()).result.current;
    const copy = { ...live };
    act(() => live.setShowPerformanceStats(true));
    expect(copy.showPerformanceStats).toBe(false);
    expect(live.showPerformanceStats).toBe(true);
  });
});

describe('usePanelsSnapshot', () => {
  it('re-renders with the new values and keeps the setters stable', () => {
    const { result } = renderHook(() => usePanelsSnapshot());
    const before = result.current;
    expect(before.isTripPanelOpen).toBe(false);
    act(() => before.setIsTripPanelOpen(true));
    expect(result.current.isTripPanelOpen).toBe(true);
    expect(result.current).not.toBe(before);
    expect(result.current.setIsTripPanelOpen).toBe(before.setIsTripPanelOpen);
  });

  it('does not re-render for a no-op write', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return usePanelsSnapshot();
    });
    const baseline = renders;
    act(() => result.current.setIsMapOpen(false));
    expect(renders).toBe(baseline);
  });
});
