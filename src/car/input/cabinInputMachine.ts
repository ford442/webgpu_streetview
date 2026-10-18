/**
 * Cabin input modes: FREE_LOOK | STEER | UI_INTERACT.
 *
 * - **STEER** (pointer locked, the default on lock): mouse X turns
 *   `carHeading` and the wheel; the head eases back to centre.
 * - **FREE_LOOK** (pointer locked): mouse moves the head only. Entered while
 *   the right button is held, or latched with `F` / the HUD button.
 * - **UI_INTERACT** (pointer free, cursor visible): the mouse moves the cursor
 *   and nothing else; clicks raycast dashboard controls. A click on the cabin
 *   that hits no control asks for the lock again (`requestPointerLock` needs
 *   that user gesture).
 *
 * The browser owns Esc: losing the lock (`pointerlockchange`) is the only way
 * Esc reaches us, and it lands in UI_INTERACT. Tab toggles UI_INTERACT ↔ the
 * previous locked mode.
 *
 * This module is pure: `transitionCabinInput` returns the next state plus at
 * most one pointer-lock effect, which the caller runs inside the same event
 * handler (so the user-gesture requirement holds).
 */

export type ControlMode = 'FREE_LOOK' | 'STEER' | 'UI_INTERACT';

export interface CabinInputState {
  /** The pointer is locked to the cabin (as last reported, or as we just asked). */
  readonly locked: boolean;
  /** FREE_LOOK latched by `F` / the HUD — survives unlock, so Tab/click return to it. */
  readonly freeLookLatched: boolean;
  /** Right mouse held — FREE_LOOK only while held; cleared when the lock goes. */
  readonly freeLookHeld: boolean;
}

export type CabinInputEvent =
  | { type: 'LOCK_ACQUIRED' }
  | { type: 'LOCK_LOST' }
  | { type: 'RMB_DOWN' }
  | { type: 'RMB_UP' }
  | { type: 'TOGGLE_FREE_LOOK' }
  | { type: 'TAB' }
  /** Primary click on the cabin in UI_INTERACT that hit no dashboard control. */
  | { type: 'CLICK_CABIN' }
  /** HUD mode button. */
  | { type: 'SELECT_MODE'; mode: ControlMode }
  /** Car view entered / left. */
  | { type: 'RESET' };

export type PointerLockEffect = 'requestPointerLock' | 'exitPointerLock';

export interface CabinInputTransition {
  state: CabinInputState;
  effect: PointerLockEffect | null;
}

export const INITIAL_CABIN_INPUT: CabinInputState = {
  locked: false,
  freeLookLatched: false,
  freeLookHeld: false,
};

export function cabinInputMode(state: CabinInputState): ControlMode {
  if (!state.locked) return 'UI_INTERACT';
  return state.freeLookLatched || state.freeLookHeld ? 'FREE_LOOK' : 'STEER';
}

const stay = (state: CabinInputState): CabinInputTransition => ({ state, effect: null });

export function transitionCabinInput(
  state: CabinInputState,
  event: CabinInputEvent,
): CabinInputTransition {
  switch (event.type) {
    case 'LOCK_ACQUIRED':
      return stay({ ...state, locked: true, freeLookHeld: false });
    case 'LOCK_LOST':
      return stay({ ...state, locked: false, freeLookHeld: false });
    case 'RMB_DOWN':
      return state.locked ? stay({ ...state, freeLookHeld: true }) : stay(state);
    case 'RMB_UP':
      return stay({ ...state, freeLookHeld: false });
    case 'TOGGLE_FREE_LOOK':
      return state.locked ? stay({ ...state, freeLookLatched: !state.freeLookLatched }) : stay(state);
    case 'TAB':
      return state.locked
        ? { state: { ...state, locked: false, freeLookHeld: false }, effect: 'exitPointerLock' }
        : { state, effect: 'requestPointerLock' };
    case 'CLICK_CABIN':
      return state.locked ? stay(state) : { state, effect: 'requestPointerLock' };
    case 'SELECT_MODE': {
      if (event.mode === 'UI_INTERACT') {
        return state.locked
          ? { state: { ...state, locked: false, freeLookHeld: false }, effect: 'exitPointerLock' }
          : stay(state);
      }
      const next = { ...state, freeLookLatched: event.mode === 'FREE_LOOK' };
      return state.locked ? stay(next) : { state: next, effect: 'requestPointerLock' };
    }
    case 'RESET':
      return {
        state: INITIAL_CABIN_INPUT,
        effect: state.locked ? 'exitPointerLock' : null,
      };
  }
}

/** Lock state after a row: held, released, or asked for (mode changes on `LOCK_ACQUIRED`). */
export type LockColumn = 'locked' | 'unlocked' | 'request lock' | 'exit lock';

export interface CabinInputTransitionRow {
  from: string;
  fromState: CabinInputState;
  trigger: string;
  event: CabinInputEvent;
  to: ControlMode;
  lock: LockColumn;
}

const UI: CabinInputState = INITIAL_CABIN_INPUT;
const UI_LATCHED: CabinInputState = { ...UI, freeLookLatched: true };
const STEER: CabinInputState = { ...UI, locked: true };
const LOOK_HELD: CabinInputState = { ...STEER, freeLookHeld: true };
const LOOK_LATCHED: CabinInputState = { ...STEER, freeLookLatched: true };

/**
 * The transition table — documentation *and* test oracle
 * (`cabinInputMachine.test.ts` replays every row through `transitionCabinInput`).
 * "request lock" rows stay in UI_INTERACT until the browser grants the lock
 * (`LOCK_ACQUIRED`), so a refused request changes nothing.
 */
export const CABIN_INPUT_TRANSITIONS: readonly CabinInputTransitionRow[] = [
  { from: 'UI_INTERACT', fromState: UI, trigger: 'click cabin (no control hit)', event: { type: 'CLICK_CABIN' }, to: 'UI_INTERACT', lock: 'request lock' },
  { from: 'UI_INTERACT', fromState: UI, trigger: 'Tab', event: { type: 'TAB' }, to: 'UI_INTERACT', lock: 'request lock' },
  { from: 'UI_INTERACT', fromState: UI, trigger: 'pointerlockchange → locked', event: { type: 'LOCK_ACQUIRED' }, to: 'STEER', lock: 'locked' },
  { from: 'UI_INTERACT (F latched)', fromState: UI_LATCHED, trigger: 'pointerlockchange → locked', event: { type: 'LOCK_ACQUIRED' }, to: 'FREE_LOOK', lock: 'locked' },
  { from: 'UI_INTERACT', fromState: UI, trigger: 'HUD “Steer”', event: { type: 'SELECT_MODE', mode: 'STEER' }, to: 'UI_INTERACT', lock: 'request lock' },
  { from: 'UI_INTERACT', fromState: UI, trigger: 'HUD “Free Look”', event: { type: 'SELECT_MODE', mode: 'FREE_LOOK' }, to: 'UI_INTERACT', lock: 'request lock' },
  { from: 'UI_INTERACT', fromState: UI, trigger: 'right mouse down', event: { type: 'RMB_DOWN' }, to: 'UI_INTERACT', lock: 'unlocked' },
  { from: 'UI_INTERACT', fromState: UI, trigger: 'F', event: { type: 'TOGGLE_FREE_LOOK' }, to: 'UI_INTERACT', lock: 'unlocked' },
  { from: 'STEER', fromState: STEER, trigger: 'right mouse down', event: { type: 'RMB_DOWN' }, to: 'FREE_LOOK', lock: 'locked' },
  { from: 'FREE_LOOK (RMB held)', fromState: LOOK_HELD, trigger: 'right mouse up', event: { type: 'RMB_UP' }, to: 'STEER', lock: 'locked' },
  { from: 'STEER', fromState: STEER, trigger: 'F', event: { type: 'TOGGLE_FREE_LOOK' }, to: 'FREE_LOOK', lock: 'locked' },
  { from: 'FREE_LOOK (F latched)', fromState: LOOK_LATCHED, trigger: 'F', event: { type: 'TOGGLE_FREE_LOOK' }, to: 'STEER', lock: 'locked' },
  { from: 'FREE_LOOK (F latched)', fromState: LOOK_LATCHED, trigger: 'right mouse up', event: { type: 'RMB_UP' }, to: 'FREE_LOOK', lock: 'locked' },
  { from: 'STEER', fromState: STEER, trigger: 'Tab', event: { type: 'TAB' }, to: 'UI_INTERACT', lock: 'exit lock' },
  { from: 'FREE_LOOK (F latched)', fromState: LOOK_LATCHED, trigger: 'Tab', event: { type: 'TAB' }, to: 'UI_INTERACT', lock: 'exit lock' },
  { from: 'STEER', fromState: STEER, trigger: 'pointerlockchange → unlocked (Esc)', event: { type: 'LOCK_LOST' }, to: 'UI_INTERACT', lock: 'unlocked' },
  { from: 'FREE_LOOK (RMB held)', fromState: LOOK_HELD, trigger: 'pointerlockchange → unlocked (Esc)', event: { type: 'LOCK_LOST' }, to: 'UI_INTERACT', lock: 'unlocked' },
  { from: 'STEER', fromState: STEER, trigger: 'leave car view', event: { type: 'RESET' }, to: 'UI_INTERACT', lock: 'exit lock' },
];

/**
 * Run a transition's pointer-lock effect. Call from inside the triggering
 * event handler — `requestPointerLock` is refused without a user gesture, and
 * a refusal just leaves us in UI_INTERACT (no `LOCK_ACQUIRED` arrives).
 */
export function applyPointerLockEffect(
  effect: PointerLockEffect | null,
  target: HTMLElement | null,
): void {
  if (!effect) return;
  if (effect === 'exitPointerLock') {
    if (typeof document !== 'undefined' && document.pointerLockElement && typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
    return;
  }
  if (!target || typeof target.requestPointerLock !== 'function') return;
  try {
    // Chromium returns a promise (rejects without a gesture); others return undefined.
    const pending = target.requestPointerLock() as unknown;
    if (pending && typeof (pending as Promise<void>).catch === 'function') {
      (pending as Promise<void>).catch(() => { /* refused — stay in UI_INTERACT */ });
    }
  } catch {
    // Old engines throw synchronously; same outcome.
  }
}
