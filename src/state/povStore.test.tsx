import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPovStore,
  usePovEffect,
  usePovSelector,
  useThrottledPov,
  type PovStore,
} from './povStore';

describe('povStore', () => {
  it('normalises on write: heading/carHeading wrap, pitch/zoom clamp', () => {
    const s = createPovStore();
    s.setHeading(-10);
    expect(s.get().heading).toBe(350);
    s.setHeading((h) => h + 20);
    expect(s.get().heading).toBe(10);
    s.setCarHeading(725);
    expect(s.get().carHeading).toBe(5);
    s.setPitch(120);
    expect(s.get().pitch).toBe(90);
    s.setPitch(-120);
    expect(s.get().pitch).toBe(-90);
    s.setZoom(0.2);
    expect(s.get().zoom).toBe(1);
    s.setZoom(9);
    expect(s.get().zoom).toBe(3);
  });

  it('keeps a stable snapshot and notifies only on real change', () => {
    const s = createPovStore({ heading: 10 });
    const l = vi.fn();
    s.subscribe(l);
    const snap = s.get();
    s.setHeading(10);
    expect(s.get()).toBe(snap);
    expect(l).not.toHaveBeenCalled();
    s.setHeading(11);
    expect(s.get()).not.toBe(snap);
    expect(l).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications and survives unsubscribe-during-notify', () => {
    const s = createPovStore();
    const b = vi.fn();
    const offA = s.subscribe(() => offA());
    s.subscribe(b);
    s.setHeading(1);
    s.setHeading(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('reset restores defaults / applies overrides', () => {
    const s = createPovStore({ heading: 5 });
    s.reset({ heading: 77 });
    expect(s.get()).toMatchObject({ heading: 77, pitch: 10, zoom: 1, carHeading: 34 });
  });
});

describe('React bindings', () => {
  let store: PovStore;
  beforeEach(() => {
    store = createPovStore({ heading: 0 });
  });

  it('usePovSelector re-renders only when the selected slice changes', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return usePovSelector((p) => Math.floor(p.heading / 10), store);
    });
    expect(result.current).toBe(0);
    const base = renders;
    act(() => store.setHeading(3));
    act(() => store.setPitch(40)); // unrelated field
    expect(renders).toBe(base);
    act(() => store.setHeading(12));
    expect(result.current).toBe(1);
    expect(renders).toBe(base + 1);
  });

  it('usePovEffect pushes values without re-rendering the host', () => {
    const sink = vi.fn();
    let renders = 0;
    function Host() {
      renders += 1;
      usePovEffect((p) => p.heading, sink, { store });
      return null;
    }
    render(<Host />);
    expect(sink).toHaveBeenLastCalledWith(0);
    const base = renders;
    act(() => {
      for (let i = 1; i <= 100; i++) store.setHeading(i);
    });
    expect(renders).toBe(base);
    expect(sink).toHaveBeenLastCalledWith(100);
    expect(sink).toHaveBeenCalledTimes(101);
  });

  it('usePovEffect immediate:false skips the mount call', () => {
    const sink = vi.fn();
    function Host() {
      usePovEffect((p) => p.heading, sink, { store, immediate: false });
      return null;
    }
    render(<Host />);
    expect(sink).not.toHaveBeenCalled();
    act(() => store.setHeading(5));
    expect(sink).toHaveBeenCalledWith(5);
  });

  describe('useThrottledPov', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('caps updates at maxHz but always lands the final value', () => {
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useThrottledPov((p) => p.heading, 10, store);
      });
      const base = renders;
      act(() => {
        for (let i = 1; i <= 200; i++) store.setHeading(i % 360);
      });
      expect(renders).toBe(base); // nothing until the trailing edge
      act(() => {
        vi.advanceTimersByTime(110);
      });
      expect(result.current).toBe(200);
      expect(renders).toBeLessThanOrEqual(base + 2);

      // sustained 60 Hz stream for 1 s → ≤ ~10 renders
      const before = renders;
      for (let f = 0; f < 60; f++) {
        act(() => {
          store.setHeading((h) => h + 1);
          vi.advanceTimersByTime(16);
        });
      }
      expect(renders - before).toBeLessThanOrEqual(12);
    });
  });
});
