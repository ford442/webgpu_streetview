import { describe, expect, it } from 'vitest';
import {
  AUTO_EXPOSURE_IDLE,
  AUTO_EXPOSURE_MAX_EV,
  nextAutoExposureEnabled,
  resolveAutoExposureFrame,
  smoothExposureStep,
  type AutoExposureFrameInput,
} from './autoExposure';
import { exposureHintFromMeanLuma } from './gpuChores/lumaMath';

const FRAME_MS = 1000 / 60;

function frame(over: Partial<AutoExposureFrameInput> = {}): AutoExposureFrameInput {
  return {
    enabled: true,
    holdActive: false,
    meanLuma: 0.09, // hint = +1 EV
    manualExposure: 0,
    dtMs: FRAME_MS,
    reducedMotion: false,
    ...over,
  };
}

describe('smoothExposureStep', () => {
  it('approaches the hint monotonically without overshooting', () => {
    let ev = 0;
    let prev = ev;
    for (let i = 0; i < 120; i++) {
      ev = smoothExposureStep(ev, 1, FRAME_MS, false);
      expect(ev).toBeGreaterThanOrEqual(prev);
      expect(ev).toBeLessThanOrEqual(1);
      prev = ev;
    }
    expect(ev).toBeGreaterThan(0.95);
  });

  it('is not instant: a single frame moves only a little', () => {
    const ev = smoothExposureStep(0, 1, FRAME_MS, false);
    expect(ev).toBeGreaterThan(0);
    expect(ev).toBeLessThan(0.1);
  });

  it('never steps past the ±2 EV clamp', () => {
    expect(smoothExposureStep(1.9, 10, 10_000, false)).toBeLessThanOrEqual(AUTO_EXPOSURE_MAX_EV);
    expect(smoothExposureStep(-1.9, -10, 10_000, false)).toBeGreaterThanOrEqual(-AUTO_EXPOSURE_MAX_EV);
    expect(smoothExposureStep(5, 0, 0, false)).toBe(AUTO_EXPOSURE_MAX_EV);
  });

  it('caps a long frame gap instead of jumping', () => {
    const ev = smoothExposureStep(0, 1, 60_000, false);
    expect(ev).toBeLessThan(1);
  });

  it('snaps under reduced motion', () => {
    expect(smoothExposureStep(0, 1.5, FRAME_MS, true)).toBe(1.5);
    expect(smoothExposureStep(0, 9, FRAME_MS, true)).toBe(AUTO_EXPOSURE_MAX_EV);
  });
});

describe('resolveAutoExposureFrame', () => {
  it('uses exposureHintFromMeanLuma for the hint', () => {
    const r = resolveAutoExposureFrame(frame({ meanLuma: 0.5 }), AUTO_EXPOSURE_IDLE);
    expect(r.hintEv).toBe(exposureHintFromMeanLuma(0.5));
  });

  it('toggle off leaves the uniform untouched and resets state', () => {
    const r = resolveAutoExposureFrame(frame({ enabled: false }), { smoothedEv: 1.2 });
    expect(r.exposure).toBeNull();
    expect(r.state.smoothedEv).toBeNull();
    expect(r.hintEv).toBeCloseTo(1, 6);
  });

  it('eases from the manual exposure on enable', () => {
    const r = resolveAutoExposureFrame(frame({ manualExposure: -0.5 }), AUTO_EXPOSURE_IDLE);
    expect(r.exposure!).toBeGreaterThan(-0.5);
    expect(r.exposure!).toBeLessThan(0);
  });

  it('converges on the hint over time', () => {
    let state = AUTO_EXPOSURE_IDLE;
    let out: number | null = null;
    for (let i = 0; i < 180; i++) {
      const r = resolveAutoExposureFrame(frame(), state);
      state = r.state;
      out = r.exposure;
    }
    expect(out!).toBeCloseTo(1, 2);
  });

  it('hold-pause freezes the last smoothed value', () => {
    let state = resolveAutoExposureFrame(frame(), AUTO_EXPOSURE_IDLE).state;
    state = resolveAutoExposureFrame(frame(), state).state;
    const frozen = state.smoothedEv!;
    for (let i = 0; i < 60; i++) {
      // A loading canvas would read very dark; the hold must ignore it.
      const r = resolveAutoExposureFrame(frame({ holdActive: true, meanLuma: 0.001 }), state);
      expect(r.exposure).toBe(frozen);
      state = r.state;
    }
    expect(state.smoothedEv).toBe(frozen);
  });

  it('holds the value when no luma sample exists', () => {
    const r = resolveAutoExposureFrame(frame({ meanLuma: null }), { smoothedEv: 0.4 });
    expect(r.exposure).toBe(0.4);
    expect(r.hintEv).toBeNull();
  });

  it('reduced motion snaps to the hint', () => {
    const r = resolveAutoExposureFrame(frame({ reducedMotion: true }), AUTO_EXPOSURE_IDLE);
    expect(r.exposure).toBeCloseTo(1, 6);
  });
});

describe('nextAutoExposureEnabled', () => {
  it('slider and preset writes suppress until the toggle is turned on again', () => {
    let on = nextAutoExposureEnabled(false, 'toggle-on');
    expect(on).toBe(true);
    for (const event of ['manual-exposure', 'color-grading-preset', 'time-of-day-preset', 'look-pack'] as const) {
      on = nextAutoExposureEnabled(true, event);
      expect(on).toBe(false);
      // A further user write keeps it off; only the toggle re-enables.
      expect(nextAutoExposureEnabled(on, 'manual-exposure')).toBe(false);
      expect(nextAutoExposureEnabled(on, 'toggle-on')).toBe(true);
    }
    expect(nextAutoExposureEnabled(true, 'toggle-off')).toBe(false);
  });
});
