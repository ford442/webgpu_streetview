import React, { useEffect, useRef, useCallback } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { povStore } from '../state/povStore';
import { useViewMode, ControlMode } from '../hooks/useViewMode';
import { freeLookDragShouldSteer } from '../car/carSpatialModel';

interface CarInputHandlerProps {
  targetRef: React.RefObject<HTMLElement | null>;
  isSteeringWheelAtPoint?: (x: number, y: number) => boolean;
  onThrust?: (direction: 'forward' | 'backward') => void;
  onSteeringDelta?: (delta: number) => void;
  /** Notifies when the U key is pressed (used for long-press immersive HUD handling). */
  onHudKeyDown?: () => void;
  /** Notifies when the U key is released (used for long-press immersive HUD handling). */
  onHudKeyUp?: () => void;
  onInteriorPointerDown?: (clientX: number, clientY: number, editMode: boolean) => boolean;
  onInteriorPointerMove?: (clientX: number, clientY: number) => boolean;
  onInteriorPointerUp?: () => void;
  interiorEditMode?: boolean;
}

/**
 * CarInputHandler - Routes input by control mode:
 * - freeLook: click-drag = head look only; chassis stays put unless the user
 *   grabs the steering wheel (temp-steer → carSteer). RMB/Shift do NOT steer.
 *   A/D = head turn. No W/S drive.
 * - uiMouse: dashboard/menus only, right-drag = steer
 * - carSteer: click-drag X = steer car heading, drag Y = pitch, W/S = drive
 *
 * World model (car body vs head): see `src/car/carSpatialModel.ts`.
 */
const CarInputHandler: React.FC<CarInputHandlerProps> = ({
  targetRef,
  isSteeringWheelAtPoint,
  onThrust,
  onSteeringDelta,
  onHudKeyDown,
  onHudKeyUp,
  onInteriorPointerDown,
  onInteriorPointerMove,
  onInteriorPointerUp,
  interiorEditMode = false,
}) => {
  const {
    setHeading,
    setPitch,
    setZoom,
    advance
  } = useStreetView();

  const {
    toggleViewMode,
    controlMode,
    toggleControlMode,
    headCoupling,
    startTempSteerMode,
    endTempSteerMode,
    isTempSteerMode,
    setCarHeading,
  } = useViewMode();

  const isDraggingRef = useRef(false);
  const isSteeringWheelDragRef = useRef(false);
  const isRightMouseRef = useRef(false);
  const dragStartedOnTargetRef = useRef(false);

  const keysPressedRef = useRef<Set<string>>(new Set());
  const onThrustRef = useRef(onThrust);
  useEffect(() => { onThrustRef.current = onThrust; }, [onThrust]);
  const onHudKeyDownRef = useRef(onHudKeyDown);
  useEffect(() => { onHudKeyDownRef.current = onHudKeyDown; }, [onHudKeyDown]);
  const onHudKeyUpRef = useRef(onHudKeyUp);
  useEffect(() => { onHudKeyUpRef.current = onHudKeyUp; }, [onHudKeyUp]);
  const onInteriorPointerDownRef = useRef(onInteriorPointerDown);
  useEffect(() => { onInteriorPointerDownRef.current = onInteriorPointerDown; }, [onInteriorPointerDown]);
  const onInteriorPointerMoveRef = useRef(onInteriorPointerMove);
  useEffect(() => { onInteriorPointerMoveRef.current = onInteriorPointerMove; }, [onInteriorPointerMove]);
  const onInteriorPointerUpRef = useRef(onInteriorPointerUp);
  useEffect(() => { onInteriorPointerUpRef.current = onInteriorPointerUp; }, [onInteriorPointerUp]);
  const interiorEditModeRef = useRef(interiorEditMode);
  useEffect(() => { interiorEditModeRef.current = interiorEditMode; }, [interiorEditMode]);
  const interiorDragRef = useRef(false);

  const HEAD_LOOK_SENSITIVITY = 0.18;
  const KEYBOARD_LOOK_RATE = 90;
  const KEYBOARD_STEER_RATE = 60;
  const MAX_LOOK_DT_S = 0.1; // clamp after a stalled frame / background tab

  const applySteering = useCallback((steerDelta: number) => {
    setCarHeading(prev => ((prev + steerDelta + 360) % 360));
    if (headCoupling === 'rigid') {
      setHeading(prev => (prev + steerDelta + 360) % 360);
    }
    onSteeringDelta?.(steerDelta * 0.5);
  }, [headCoupling, setCarHeading, setHeading, onSteeringDelta]);

  const clearDragState = useCallback(() => {
    if (isSteeringWheelDragRef.current) {
      endTempSteerMode();
    }
    isDraggingRef.current = false;
    isSteeringWheelDragRef.current = false;
    isRightMouseRef.current = false;
    dragStartedOnTargetRef.current = false;
  }, [endTempSteerMode]);

  // Drop any in-progress drag when switching control modes (but not during a
  // steering-wheel hold, which intentionally switches into temp carSteer).
  useEffect(() => {
    if (controlMode === 'freeLook') {
      isSteeringWheelDragRef.current = false;
    }
    if (!isTempSteerMode) {
      clearDragState();
    }
  }, [controlMode, isTempSteerMode, clearDragState]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const getEffectiveControlMode = (): ControlMode => controlMode;

    const isMouseButtonHeld = (e: MouseEvent): boolean =>
      (e.buttons & 1) !== 0 || (e.buttons & 2) !== 0;

    const handleMouseDown = (e: MouseEvent) => {
      const editMode = interiorEditModeRef.current || (e.shiftKey && controlMode === 'freeLook');
      if (editMode && e.button === 0) {
        const hit = onInteriorPointerDownRef.current?.(e.clientX, e.clientY, true);
        if (hit) {
          interiorDragRef.current = true;
          e.stopPropagation();
          return;
        }
      }

      if (controlMode === 'uiMouse' && e.button === 0) return;

      if (e.button === 0) {
        isDraggingRef.current = true;
        dragStartedOnTargetRef.current = true;
        const onWheel = !!isSteeringWheelAtPoint?.(e.clientX, e.clientY);
        isSteeringWheelDragRef.current = onWheel;
        if (getEffectiveControlMode() === 'freeLook' && onWheel) {
          startTempSteerMode();
        }
        isRightMouseRef.current = false;
      } else if (e.button === 2) {
        isDraggingRef.current = true;
        dragStartedOnTargetRef.current = true;
        isRightMouseRef.current = true;
        isSteeringWheelDragRef.current = false;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (controlMode === 'uiMouse') return;
      e.preventDefault();
      setZoom(prev => Math.max(0.5, Math.min(3, prev - e.deltaY * 0.001)));
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (interiorDragRef.current) {
        if (onInteriorPointerMoveRef.current?.(e.clientX, e.clientY)) {
          return;
        }
      }

      const currentMode = getEffectiveControlMode();
      if (!isDraggingRef.current || !dragStartedOnTargetRef.current) return;

      // Require an actual held mouse button — prevents stale drag state from
      // mode switches or missed mouseup events from panning without a click.
      if (!isMouseButtonHeld(e)) {
        clearDragState();
        return;
      }

      if (currentMode === 'freeLook') {
        // Chassis steers only during steering-wheel grab (temp-steer handoff
        // frames before controlMode flips to carSteer). RMB/Shift do not steer.
        const steeringDrag = freeLookDragShouldSteer({
          isSteeringWheelDrag: isSteeringWheelDragRef.current,
          isRightMouse: isRightMouseRef.current,
          shiftKey: e.shiftKey,
        });
        if (steeringDrag) {
          applySteering(e.movementX * 0.3);
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        } else {
          setHeading(prev => (prev + e.movementX * HEAD_LOOK_SENSITIVITY + 360) % 360);
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        }
      } else if (currentMode === 'carSteer') {
        const maySteerChassis = !isTempSteerMode || isSteeringWheelDragRef.current;
        if (maySteerChassis) {
          applySteering(e.movementX * 0.3);
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        } else {
          setHeading(prev => (prev + e.movementX * HEAD_LOOK_SENSITIVITY + 360) % 360);
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        }
      } else if (currentMode === 'uiMouse' && isRightMouseRef.current) {
        applySteering(e.movementX * 0.3);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (interiorDragRef.current) {
        interiorDragRef.current = false;
        onInteriorPointerUpRef.current?.();
      }
      if (e.button === 0 || e.button === 2) {
        clearDragState();
      }
    };

    // Keyboard look/steer is frame-rate driven: while A/D are held a rAF loop
    // integrates KEYBOARD_*_RATE (deg/s) over the real frame delta, so turn speed
    // no longer depends on the OS key-repeat delay/rate.
    let lookRaf: number | null = null;
    let lookLast = 0;
    const lookDir = (): number =>
      (keysPressedRef.current.has('d') ? 1 : 0) - (keysPressedRef.current.has('a') ? 1 : 0);
    const stepLook = (now: number) => {
      const dt = Math.min(MAX_LOOK_DT_S, Math.max(0, (now - lookLast) / 1000));
      lookLast = now;
      const dir = lookDir();
      if (dir === 0 || dt === 0) return;
      if (controlMode === 'freeLook') {
        setHeading(prev => prev + dir * KEYBOARD_LOOK_RATE * dt);
      } else if (controlMode === 'carSteer') {
        applySteering(dir * KEYBOARD_STEER_RATE * dt);
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
        case 'w':
        case 'arrowup':
          if (controlMode === 'freeLook') break;
          if (key.startsWith('arrow')) e.preventDefault();
          advance('forward', povStore.get().carHeading);
          onThrustRef.current?.('forward');
          break;
        case 's':
        case 'arrowdown':
          if (controlMode === 'freeLook') break;
          if (key.startsWith('arrow')) e.preventDefault();
          advance('backward', povStore.get().carHeading);
          onThrustRef.current?.('backward');
          break;
        case 'arrowleft':
          if (controlMode === 'freeLook') break;
          e.preventDefault();
          advance('left', povStore.get().carHeading);
          break;
        case 'arrowright':
          if (controlMode === 'freeLook') break;
          e.preventDefault();
          advance('right', povStore.get().carHeading);
          break;
        case 'a':
        case 'd':
          ensureLookLoop();
          break;
        case 'q':
          e.preventDefault();
          if (controlMode === 'carSteer') applySteering(-45);
          break;
        case 'e':
          e.preventDefault();
          if (controlMode === 'carSteer') applySteering(45);
          break;
        case 'c': {
          const pov = povStore.get();
          const headYawOffset = (pov.heading - pov.carHeading + 540) % 360 - 180;
          if (Math.abs(headYawOffset) > 1 || Math.abs(pov.pitch - 10) > 1) {
            setHeading(pov.carHeading);
            setPitch(10);
          } else {
            toggleViewMode();
          }
          break;
        }
        case 'h':
          clearDragState();
          toggleControlMode();
          break;
        case 'u':
          if (!e.repeat) onHudKeyDownRef.current?.();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const upKey = e.key.toLowerCase();
      if (upKey === 'u') {
        onHudKeyUpRef.current?.();
      }
      // Credit the time held since the last frame so a sub-frame tap still turns.
      if (upKey === 'a' || upKey === 'd') stepLook(performance.now());
      keysPressedRef.current.delete(e.key.toLowerCase());
      keysPressedRef.current.delete(e.key);
    };

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
      window.removeEventListener('blur', handleBlur);
      target.removeEventListener('mousedown', handleMouseDown);
      target.removeEventListener('wheel', handleWheel);
      target.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    targetRef,
    isSteeringWheelAtPoint,
    controlMode,
    headCoupling,
    setHeading,
    setPitch,
    setZoom,
    advance,
    toggleViewMode,
    toggleControlMode,
    startTempSteerMode,
    endTempSteerMode,
    setCarHeading,
    applySteering,
    onSteeringDelta,
    isTempSteerMode,
    clearDragState,
  ]);

  return null;
};

export default CarInputHandler;
