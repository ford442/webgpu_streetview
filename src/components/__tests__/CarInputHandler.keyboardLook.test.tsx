// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarInputHandler from '../CarInputHandler';
import { povStore } from '../../state/povStore';

let controlMode: 'freeLook' | 'uiMouse' | 'carSteer' = 'freeLook';

vi.mock('../../hooks/useStreetView', () => ({
  useStreetView: () => ({
    setHeading: povStore.setHeading,
    setPitch: povStore.setPitch,
    setZoom: povStore.setZoom,
    advance: vi.fn(),
  }),
}));

vi.mock('../../hooks/useViewMode', () => ({
  useViewMode: () => ({
    toggleViewMode: vi.fn(),
    controlMode,
    toggleControlMode: vi.fn(),
    headCoupling: 'free',
    startTempSteerMode: vi.fn(),
    endTempSteerMode: vi.fn(),
    isTempSteerMode: false,
    setCarHeading: povStore.setCarHeading,
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

describe('CarInputHandler keyboard look (rAF, dt-based)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    controlMode = 'freeLook';
    povStore.reset({ heading: 100, pitch: 10, carHeading: 100 });
  });
  afterEach(() => vi.useRealTimers());

  it('turns at KEYBOARD_LOOK_RATE deg/s regardless of frame rate', () => {
    for (const frameMs of [1000 / 120, 1000 / 60, 1000 / 30]) {
      povStore.reset({ heading: 100 });
      const { unmount } = render(<Harness />);
      act(() => key('keydown', 'd'));
      runFrames(1000, frameMs);
      act(() => key('keyup', 'd'));
      // 90°/s for ~1 s (frame quantisation ≤ one frame of drift)
      expect(povStore.get().heading).toBeCloseTo(190, -1);
      expect(Math.abs(povStore.get().heading - 190)).toBeLessThan(8);
      unmount();
    }
  });

  it('is independent of OS key-repeat: repeated keydowns add nothing', () => {
    render(<Harness />);
    act(() => key('keydown', 'd'));
    for (let i = 0; i < 50; i++) act(() => key('keydown', 'd', true));
    const afterRepeats = povStore.get().heading;
    expect(afterRepeats).toBe(100); // no frame has elapsed → no turn from keydown spam
    runFrames(500, 1000 / 60);
    act(() => key('keyup', 'd'));
    expect(Math.abs(povStore.get().heading - 145)).toBeLessThan(5);
  });

  it('A turns left, D turns right, both cancel, release stops the loop', () => {
    render(<Harness />);
    act(() => key('keydown', 'a'));
    runFrames(500, 1000 / 60);
    act(() => key('keyup', 'a'));
    expect(povStore.get().heading).toBeLessThan(100);

    povStore.reset({ heading: 100 });
    act(() => {
      key('keydown', 'a');
      key('keydown', 'd');
    });
    runFrames(300, 1000 / 60);
    expect(povStore.get().heading).toBe(100);

    act(() => {
      key('keyup', 'a');
      key('keyup', 'd');
    });
    runFrames(300, 1000 / 60);
    expect(povStore.get().heading).toBe(100);
  });

  it('a sub-frame tap still turns proportionally to hold time', () => {
    render(<Harness />);
    act(() => {
      key('keydown', 'd');
      vi.advanceTimersByTime(10); // < one 60 Hz frame; the loop has not ticked yet
      key('keyup', 'd');
    });
    expect(povStore.get().heading).toBeGreaterThan(100);
    expect(povStore.get().heading).toBeLessThan(102);
  });

  it('steers the chassis (not the head) in carSteer mode', () => {
    controlMode = 'carSteer';
    render(<Harness />);
    act(() => key('keydown', 'd'));
    runFrames(500, 1000 / 60);
    act(() => key('keyup', 'd'));
    expect(povStore.get().carHeading).toBeGreaterThan(110); // 60°/s × 0.5 s ≈ 30°
    expect(povStore.get().heading).toBe(100); // headCoupling 'free' here
  });

  it('stops turning on window blur (no stuck key)', () => {
    render(<Harness />);
    act(() => key('keydown', 'd'));
    runFrames(100, 1000 / 60);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    const h = povStore.get().heading;
    runFrames(500, 1000 / 60);
    expect(povStore.get().heading).toBe(h);
  });
});
