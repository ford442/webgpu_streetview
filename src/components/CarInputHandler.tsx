import React, { useEffect, useRef } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { povStore } from '../state/povStore';
import { cabinHeadStore } from '../state/cabinHeadStore';
import { useViewMode } from '../hooks/useViewMode';
import { applyPointerLockEffect, type CabinInputEvent } from '../car/input/cabinInputMachine';
import { setXrCabinInputListener } from '../xr/xrCabinInput';
import { FREE_LOOK_RAD_PER_PX, steerDeltaFromMouse } from '../car/carSpatialModel';

interface CarInputHandlerProps {
  /** The cabin view element: pointer-lock target and click surface. */
  targetRef: React.RefObject<HTMLElement | null>;
  /**
   * True when a UI_INTERACT click lands on a dashboard control handled
   * elsewhere (e.g. the centre display's own click handler) — such a click
   * must not grab the pointer.
   */
  isDashboardControlAtPoint?: (x: number, y: number) => boolean;
  onThrust?: (direction: 'forward' | 'backward') => void;
  onSteeringDelta?: (delta: number) => void;
  /** Notifies when the U key is pressed (used for long-press immersive HUD handling). */
  onHudKeyDown?: () => void;
  /** Notifies when the U key is released (used for long-press immersive HUD handling). */
  onHudKeyUp?: () => void;
  /** UI_INTERACT raycast against cabin controls (buttons, knobs, levers). True = hit. */
  onInteriorPointerDown?: (clientX: number, clientY: number, editMode: boolean) => boolean;
  onInteriorPointerMove?: (clientX: number, clientY: number) => boolean;
  onInteriorPointerUp?: () => void;
}

/** Keyboard head turn in FREE_LOOK (radians per second). */
const KEYBOARD_LOOK_RATE = Math.PI / 2;
/** Keyboard steering in STEER / UI_INTERACT (degrees of carHeading per second). */
const KEYBOARD_STEER_RATE = 60;
const MAX_LOOK_DT_S = 0.1; // clamp after a stalled frame / background tab
/** Steering-wheel visual turn per degree of heading change. */
const WHEEL_PER_HEADING_DEG = 0.5;

/**
 * CarInputHandler — feeds DOM input to the cabin input machine
 * (`car/input/cabinInputMachine.ts`) and applies the current mode:
 *
 * - **STEER** (locked): mouse X → `carHeading` (rate-limited) + wheel. The head
 *   eases back to centre in the frame loop (`useCarDashboardBridge`).
 * - **FREE_LOOK** (locked; hold RMB or toggle F): mouse → `headYaw`/`headPitch`.
 *   The car is untouched.
 * - **UI_INTERACT** (unlocked): the mouse moves the cursor and nothing else;
 *   clicks raycast dashboard controls; a click on bare cabin re-locks.
 *
 * Tab toggles UI_INTERACT ↔ the previous locked mode. Esc belongs to the
 * browser — losing the lock (`pointerlockchange`) is what lands us in
 * UI_INTERACT. The first mouse delta after any lock change is dropped
 * (browsers report a spurious jump).
 *
 * Input only writes `carHeading` (povStore) and the head pose
 * (`cabinHeadStore`); the Street View POV is derived from them once per frame.
 * World model: `src/car/carSpatialModel.ts`.
 */
const CarInputHandler: React.FC<CarInputHandlerProps> = ({
  targetRef,
  isDashboardControlAtPoint,
  onThrust,
  onSteeringDelta,
  onHudKeyDown,
  onHudKeyUp,
  onInteriorPointerDown,
  onInteriorPointerMove,
  onInteriorPointerUp,
}) => {
  const { setZoom, advance } = useStreetView();
  const { toggleViewMode, controlMode, dispatchCabinInput } = useViewMode();

  const callbacksRef = useRef({
    isDashboardControlAtPoint,
    onThrust,
    onSteeringDelta,
    onHudKeyDown,
    onHudKeyUp,
    onInteriorPointerDown,
    onInteriorPointerMove,
    onInteriorPointerUp,
  });
  callbacksRef.current = {
    isDashboardControlAtPoint,
    onThrust,
    onSteeringDelta,
    onHudKeyDown,
    onHudKeyUp,
    onInteriorPointerDown,
    onInteriorPointerMove,
    onInteriorPointerUp,
  };

  // Survive listener re-registration on mode changes.
  const skipNextMoveRef = useRef(false);
  const lastSteerTimeRef = useRef<number | null>(null);
  const interiorDragRef = useRef(false);
  const keysPressedRef = useRef<Set<string>>(new Set());

  // Leaving the car view drops the lock and resets the machine.
  useEffect(() => {
    const target = targetRef.current;
    return () => {
      applyPointerLockEffect(dispatchCabinInput({ type: 'RESET' }).effect, target);
    };
  }, [dispatchCabinInput, targetRef]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const steer = (deltaDeg: number) => {
      if (deltaDeg === 0) return;
      povStore.setCarHeading((prev) => prev + deltaDeg);
      callbacksRef.current.onSteeringDelta?.(deltaDeg * WHEEL_PER_HEADING_DEG);
    };

    const dispatch = (event: CabinInputEvent) => {
      const { effect, steerDeg } = dispatchCabinInput(event);
      applyPointerLockEffect(effect, target);
      // Only the machine says how far to steer from a stick (STEER, in a session).
      if (steerDeg) steer(steerDeg);
    };

    // A WebXR session's enter/exit and left stick (#331) come through the same machine.
    setXrCabinInputListener(dispatch);

    const turnHead = (dYaw: number, dPitch: number) => {
      const { headYaw, headPitch } = cabinHeadStore.get();
      cabinHeadStore.set({ headYaw: headYaw + dYaw, headPitch: headPitch + dPitch });
    };

    const handlePointerLockChange = () => {
      skipNextMoveRef.current = true;
      lastSteerTimeRef.current = null;
      dispatch({ type: document.pointerLockElement === target ? 'LOCK_ACQUIRED' : 'LOCK_LOST' });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (controlMode === 'UI_INTERACT') {
        if (e.button !== 0) return;
        // Only bare cabin counts. HUD overlays stop propagation in React, but
        // React dispatches at the root — after this native listener has run.
        if (e.target !== target && !(e.target instanceof HTMLCanvasElement)) return;
        const cb = callbacksRef.current;
        if (cb.onInteriorPointerDown?.(e.clientX, e.clientY, true)) {
          interiorDragRef.current = true;
          e.stopPropagation();
          return;
        }
        if (cb.isDashboardControlAtPoint?.(e.clientX, e.clientY)) return;
        dispatch({ type: 'CLICK_CABIN' });
        return;
      }
      if (e.button === 2) dispatch({ type: 'RMB_DOWN' });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (interiorDragRef.current) {
        interiorDragRef.current = false;
        callbacksRef.current.onInteriorPointerUp?.();
      }
      if (e.button === 2) dispatch({ type: 'RMB_UP' });
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (interiorDragRef.current) {
        callbacksRef.current.onInteriorPointerMove?.(e.clientX, e.clientY);
        return;
      }
      // UI_INTERACT: the cursor moves; head, car and panorama do not.
      if (controlMode === 'UI_INTERACT') return;
      if (skipNextMoveRef.current) {
        skipNextMoveRef.current = false;
        return;
      }
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (controlMode === 'FREE_LOOK') {
        // +yaw looks left, +pitch looks up; mouse right/up is +X/−Y.
        turnHead(-dx * FREE_LOOK_RAD_PER_PX, -dy * FREE_LOOK_RAD_PER_PX);
        return;
      }
      const last = lastSteerTimeRef.current;
      lastSteerTimeRef.current = e.timeStamp;
      const dt = last === null ? 1 / 60 : (e.timeStamp - last) / 1000;
      steer(steerDeltaFromMouse(dx, dt));
    };

    const handleWheel = (e: WheelEvent) => {
      if (controlMode === 'UI_INTERACT') return;
      e.preventDefault();
      setZoom((prev) => Math.max(0.5, Math.min(3, prev - e.deltaY * 0.001)));
    };

    // Keyboard look/steer is frame-rate driven: while A/D are held a rAF loop
    // integrates the rate over the real frame delta, so turn speed does not
    // depend on the OS key-repeat delay/rate.
    let lookRaf: number | null = null;
    let lookLast = 0;
    const lookDir = (): number =>
      (keysPressedRef.current.has('d') ? 1 : 0) - (keysPressedRef.current.has('a') ? 1 : 0);
    const stepLook = (now: number) => {
      const dt = Math.min(MAX_LOOK_DT_S, Math.max(0, (now - lookLast) / 1000));
      lookLast = now;
      const dir = lookDir();
      if (dir === 0 || dt === 0) return;
      if (controlMode === 'FREE_LOOK') {
        turnHead(-dir * KEYBOARD_LOOK_RATE * dt, 0);
      } else {
        steer(dir * KEYBOARD_STEER_RATE * dt);
      }
    };
    const lookFrame = (now: number) => {
      lookRaf = null;
      stepLook(now);
      if (lookDir() !== 0) lookRaf = requestAnimationFrame(lookFrame);
    };
    const ensureLookLoop = () => {
      if (lookRaf !== null || lookDir() === 0) return;
      lookLast = performance.now();
      lookRaf = requestAnimationFrame(lookFrame);
    };
    const stopLookLoop = () => {
      if (lookRaf !== null) cancelAnimationFrame(lookRaf);
      lookRaf = null;
    };
    const handleBlur = () => {
      keysPressedRef.current.clear();
      stopLookLoop();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement) {
        return;
      }

      const key = e.key.toLowerCase();
      keysPressedRef.current.add(key);

      switch (key) {
        case 'tab': {
          // While the cursor is free and focus sits on a HUD control or a modal,
          // Tab keeps its keyboard-navigation job.
          const focused = document.activeElement;
          const focusOnControl = focused instanceof HTMLElement && focused !== document.body && focused !== target;
          if (!document.pointerLockElement && focusOnControl) break;
          // Keydown is a user gesture, so a Tab back into a locked mode can
          // request the lock right here.
          e.preventDefault();
          dispatch({ type: 'TAB' });
          break;
        }
        case 'f':
          // Shift+F is cinema mode (useAppKeyboardShortcuts).
          if (!e.repeat && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            dispatch({ type: 'TOGGLE_FREE_LOOK' });
          }
          break;
        case 'w':
        case 'arrowup':
          if (key.startsWith('arrow')) e.preventDefault();
          advance('forward', povStore.get().carHeading);
          callbacksRef.current.onThrust?.('forward');
          break;
        case 's':
        case 'arrowdown':
          if (key.startsWith('arrow')) e.preventDefault();
          advance('backward', povStore.get().carHeading);
          callbacksRef.current.onThrust?.('backward');
          break;
        case 'arrowleft':
          e.preventDefault();
          advance('left', povStore.get().carHeading);
          break;
        case 'arrowright':
          e.preventDefault();
          advance('right', povStore.get().carHeading);
          break;
        case 'a':
        case 'd':
          ensureLookLoop();
          break;
        case 'q':
          e.preventDefault();
          if (controlMode !== 'FREE_LOOK') steer(-45);
          break;
        case 'e':
          e.preventDefault();
          if (controlMode !== 'FREE_LOOK') steer(45);
          break;
        case 'c': {
          const { headYaw, headPitch } = cabinHeadStore.get();
          if (Math.abs(headYaw) > 0.017 || Math.abs(headPitch) > 0.017) {
            cabinHeadStore.reset();
          } else {
            toggleViewMode();
          }
          break;
        }
        case 'u':
          if (!e.repeat) callbacksRef.current.onHudKeyDown?.();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const upKey = e.key.toLowerCase();
      if (upKey === 'u') {
        callbacksRef.current.onHudKeyUp?.();
      }
      // Credit the time held since the last frame so a sub-frame tap still turns.
      if (upKey === 'a' || upKey === 'd') stepLook(performance.now());
      keysPressedRef.current.delete(e.key.toLowerCase());
      keysPressedRef.current.delete(e.key);
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    target.addEventListener('mousedown', handleMouseDown);
    target.addEventListener('wheel', handleWheel, { passive: false });
    target.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    ensureLookLoop(); // a mode switch while A/D is held keeps turning

    return () => {
      stopLookLoop();
      setXrCabinInputListener(null);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('blur', handleBlur);
      target.removeEventListener('mousedown', handleMouseDown);
      target.removeEventListener('wheel', handleWheel);
      target.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [targetRef, controlMode, dispatchCabinInput, setZoom, advance, toggleViewMode]);

  return null;
};

export default CarInputHandler;
