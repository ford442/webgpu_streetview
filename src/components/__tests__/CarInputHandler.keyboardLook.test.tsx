// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CABIN_INPUT } from '../../car/input/cabinInputMachine';
import CarInputHandler from '../CarInputHandler';
import { povStore } from '../../state/povStore';
import { cabinHeadStore } from '../../state/cabinHeadStore';
import type { ControlMode } from '../../car/input/cabinInputMachine';

let controlMode: ControlMode = 'FREE_LOOK';

vi.mock('../../hooks/useStreetView', () => ({
  useStreetView: () => ({
    setZoom: povStore.setZoom,
    advance: vi.fn(),
  }),
}));

vi.mock('../../hooks/useViewMode', () => ({
  useViewMode: () => ({
    toggleViewMode: vi.fn(),
    controlMode,
    dispatchCabinInput: vi.fn(() => ({ state: INITIAL_CABIN_INPUT, effect: null })),
  }),
}));

const Harness: React.FC = () => {
  const targetRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={targetRef}>
      <CarInputHandler targetRef={targetRef} />
    </div>
  );
};

const key = (type: 'keydown' | 'keyup', k: string, repeat = false) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: k, repeat, bubbles: true }));

/** Advance `ms` of fake time in frames of `frameMs`. */
function runFrames(ms: number, frameMs: number) {
  for (let t = 0; t < ms; t += frameMs) {
    act(() => {
      vi.advanceTimersByTime(frameMs);
    });
  }
}

const yawDeg = () => (cabinHeadStore.get().headYaw * 180) / Math.PI;

describe('CarInputHandler keyboard look (rAF, dt-based)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    controlMode = 'FREE_LOOK';
    povStore.reset({ heading: 100, pitch: 10, carHeading: 100 });
    cabinHeadStore.reset();
  });
  afterEach(() => vi.useRealTimers());

  it('turns the head at 90°/s regardless of frame rate (D = right = −yaw)', () => {
    for (const frameMs of [1000 / 120, 1000 / 60, 1000 / 30]) {
      cabinHeadStore.reset();
      const { unmount } = render(<Harness />);
      act(() => { key('keydown', 'd'); });
      runFrames(500, frameMs);
      act(() => { key('keyup', 'd'); });
      // 90°/s for ~0.5 s (frame quantisation ≤ one frame of drift)
      expect(Math.abs(yawDeg() + 45)).toBeLessThan(4);
      expect(povStore.get().carHeading).toBe(100);
      unmount();
    }
  });

  it('is independent of OS key-repeat: repeated keydowns add nothing', () => {
    render(<Harness />);
    act(() => { key('keydown', 'd'); });
    for (let i = 0; i < 50; i++) act(() => { key('keydown', 'd', true); });
    expect(yawDeg()).toBe(0); // no frame has elapsed → no turn from keydown spam
    runFrames(250, 1000 / 60);
    act(() => { key('keyup', 'd'); });
    expect(Math.abs(yawDeg() + 22.5)).toBeLessThan(3);
  });

  it('A looks left, both cancel, release stops the loop; the head clamps at 90°', () => {
    render(<Harness />);
    act(() => { key('keydown', 'a'); });
    runFrames(500, 1000 / 60);
    act(() => { key('keyup', 'a'); });
    expect(yawDeg()).toBeGreaterThan(0);

    cabinHeadStore.reset();
    act(() => {
      key('keydown', 'a');
      key('keydown', 'd');
    });
    runFrames(300, 1000 / 60);
    expect(yawDeg()).toBe(0);
    act(() => {
      key('keyup', 'a');
      key('keyup', 'd');
    });

    act(() => { key('keydown', 'a'); });
    runFrames(3000, 1000 / 60);
    act(() => { key('keyup', 'a'); });
    expect(yawDeg()).toBeCloseTo(90, 6);
  });

  it('a sub-frame tap still turns proportionally to hold time', () => {
    render(<Harness />);
    act(() => {
      key('keydown', 'd');
      vi.advanceTimersByTime(10); // < one 60 Hz frame; the loop has not ticked yet
      key('keyup', 'd');
    });
    expect(yawDeg()).toBeLessThan(0);
    expect(yawDeg()).toBeGreaterThan(-2);
  });

  it('steers the car (not the head) in STEER mode', () => {
    controlMode = 'STEER';
    render(<Harness />);
    act(() => { key('keydown', 'd'); });
    runFrames(500, 1000 / 60);
    act(() => { key('keyup', 'd'); });
    expect(povStore.get().carHeading).toBeGreaterThan(110); // 60°/s × 0.5 s ≈ 30°
    expect(cabinHeadStore.get().headYaw).toBe(0);
  });

  it('stops turning on window blur (no stuck key)', () => {
    render(<Harness />);
    act(() => { key('keydown', 'd'); });
    runFrames(100, 1000 / 60);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    const h = yawDeg();
    runFrames(500, 1000 / 60);
    expect(yawDeg()).toBe(h);
  });
});
