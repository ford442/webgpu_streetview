import { describe, expect, it } from 'vitest';
import {
  CABIN_INPUT_TRANSITIONS,
  INITIAL_CABIN_INPUT,
  cabinInputMode,
  transitionCabinInput,
  type CabinInputEvent,
  type CabinInputState,
} from './cabinInputMachine';

const run = (state: CabinInputState, ...events: CabinInputEvent[]) =>
  events.reduce((s, e) => transitionCabinInput(s, e).state, state);

describe('cabin input machine', () => {
  it.each(CABIN_INPUT_TRANSITIONS.map((row) => [`${row.from} + ${row.trigger}`, row] as const))(
    'table row: %s',
    (_name, row) => {
      expect(cabinInputMode(row.fromState).replace(/ .*/, '')).toBe(row.from.replace(/ .*/, ''));
      const { state, effect } = transitionCabinInput(row.fromState, row.event);
      expect(cabinInputMode(state)).toBe(row.to);
      const expectedEffect =
        row.lock === 'request lock' ? 'requestPointerLock'
          : row.lock === 'exit lock' ? 'exitPointerLock'
            : null;
      expect(effect).toBe(expectedEffect);
      if (row.lock === 'locked') expect(state.locked).toBe(true);
      if (row.lock === 'unlocked' || row.lock === 'exit lock') expect(state.locked).toBe(false);
      if (row.steerDeg !== undefined) expect(transitionCabinInput(row.fromState, row.event).steerDeg ?? 0).toBeCloseTo(row.steerDeg, 9);
    },
  );

  it('starts unlocked in UI_INTERACT and defaults to STEER on first lock', () => {
    expect(cabinInputMode(INITIAL_CABIN_INPUT)).toBe('UI_INTERACT');
    expect(cabinInputMode(run(INITIAL_CABIN_INPUT, { type: 'LOCK_ACQUIRED' }))).toBe('STEER');
  });

  it('Esc mid-hold forgets the held right button but keeps the F latch', () => {
    const held = run(INITIAL_CABIN_INPUT, { type: 'LOCK_ACQUIRED' }, { type: 'RMB_DOWN' }, { type: 'LOCK_LOST' });
    expect(cabinInputMode(run(held, { type: 'LOCK_ACQUIRED' }))).toBe('STEER');

    const latched = run(INITIAL_CABIN_INPUT, { type: 'LOCK_ACQUIRED' }, { type: 'TOGGLE_FREE_LOOK' }, { type: 'LOCK_LOST' });
    expect(cabinInputMode(run(latched, { type: 'LOCK_ACQUIRED' }))).toBe('FREE_LOOK');
  });

  it('Tab out then the browser’s own unlock event is a no-op', () => {
    const out = run(INITIAL_CABIN_INPUT, { type: 'LOCK_ACQUIRED' }, { type: 'TAB' });
    expect(run(out, { type: 'LOCK_LOST' })).toEqual(out);
  });

  it('HUD buttons pick the mode the lock will land in', () => {
    const free = transitionCabinInput(INITIAL_CABIN_INPUT, { type: 'SELECT_MODE', mode: 'FREE_LOOK' });
    expect(free.effect).toBe('requestPointerLock');
    expect(cabinInputMode(run(free.state, { type: 'LOCK_ACQUIRED' }))).toBe('FREE_LOOK');

    const steer = transitionCabinInput(free.state, { type: 'SELECT_MODE', mode: 'STEER' });
    expect(cabinInputMode(run(steer.state, { type: 'LOCK_ACQUIRED' }))).toBe('STEER');
  });

  it('a mode is a pure function of state (no hidden fields)', () => {
    for (const row of CABIN_INPUT_TRANSITIONS) {
      expect(Object.keys(row.fromState).sort()).toEqual(['freeLookHeld', 'freeLookLatched', 'locked', 'xr']);
    }
  });

  it('a WebXR session steers only through the stick, and leaving it returns to the cursor (#331)', () => {
    const inXr = run(INITIAL_CABIN_INPUT, { type: 'LOCK_ACQUIRED' }, { type: 'TOGGLE_FREE_LOOK' }, { type: 'XR_ENTER' });
    expect(cabinInputMode(inXr)).toBe('STEER');
    // Desktop gestures do nothing mid-session — no lock requests behind the headset.
    for (const event of [{ type: 'CLICK_CABIN' }, { type: 'TAB' }, { type: 'SELECT_MODE', mode: 'FREE_LOOK' }] as const) {
      expect(transitionCabinInput(inXr, event)).toEqual({ state: inXr, effect: null });
    }
    const left = transitionCabinInput(inXr, { type: 'XR_STICK', axisX: -0.6, dtS: 1 / 72 }).steerDeg ?? 0;
    expect(left).toBeLessThan(0);
    // The F latch survives the session, like it survives Esc.
    expect(cabinInputMode(run(inXr, { type: 'XR_EXIT' }, { type: 'LOCK_ACQUIRED' }))).toBe('FREE_LOOK');
    expect(run(inXr, { type: 'RESET' })).toEqual(INITIAL_CABIN_INPUT);
  });
});
