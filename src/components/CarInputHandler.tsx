import React, { useEffect, useRef, useCallback } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useViewMode, ControlMode } from '../hooks/useViewMode';

interface CarInputHandlerProps {
  targetRef: React.RefObject<HTMLElement | null>;
  isSteeringWheelAtPoint?: (x: number, y: number) => boolean;
  onThrust?: (direction: 'forward' | 'backward') => void;
  onSteeringDelta?: (delta: number) => void;
  /** Toggle the 2D dashboard HUD (bound to the `U` key) so the cockpit can be seen unobstructed. */
  onToggleHud?: () => void;
  onInteriorPointerDown?: (clientX: number, clientY: number, editMode: boolean) => boolean;
  onInteriorPointerMove?: (clientX: number, clientY: number) => boolean;
  onInteriorPointerUp?: () => void;
  interiorEditMode?: boolean;
}

/**
 * CarInputHandler - Routes input by control mode:
 * - freeLook: click-drag = head look, A/D = head turn, car stays put (no W/S drive)
 * - uiMouse: dashboard/menus only, right-drag = steer
 * - carSteer: click-drag X = steer car heading, drag Y = pitch, W/S = drive
 */
const CarInputHandler: React.FC<CarInputHandlerProps> = ({
  targetRef,
  isSteeringWheelAtPoint,
  onThrust,
  onSteeringDelta,
  onToggleHud,
  onInteriorPointerDown,
  onInteriorPointerMove,
  onInteriorPointerUp,
  interiorEditMode = false,
}) => {
  const {
    heading,
    pitch,
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
    carHeading,
    setCarHeading,
  } = useViewMode();

  const isDraggingRef = useRef(false);
  const isSteeringWheelDragRef = useRef(false);
  const isRightMouseRef = useRef(false);
  const dragStartedOnTargetRef = useRef(false);

  const keysPressedRef = useRef<Set<string>>(new Set());
  const onThrustRef = useRef(onThrust);
  useEffect(() => { onThrustRef.current = onThrust; }, [onThrust]);
  const onToggleHudRef = useRef(onToggleHud);
  useEffect(() => { onToggleHudRef.current = onToggleHud; }, [onToggleHud]);
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
        const steeringDrag = isSteeringWheelDragRef.current || isRightMouseRef.current || e.shiftKey;
        if (steeringDrag) {
          applySteering(e.movementX * 0.3);
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        } else {
          setHeading(prev => (prev + e.movementX * HEAD_LOOK_SENSITIVITY + 360) % 360);
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        }
      } else if (currentMode === 'carSteer') {
        applySteering(e.movementX * 0.3);
        setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
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
          advance('forward', carHeading);
          onThrustRef.current?.('forward');
          break;
        case 's':
        case 'arrowdown':
          if (controlMode === 'freeLook') break;
          if (key.startsWith('arrow')) e.preventDefault();
          advance('backward', carHeading);
          onThrustRef.current?.('backward');
          break;
        case 'arrowleft':
          if (controlMode === 'freeLook') break;
          e.preventDefault();
          advance('left', carHeading);
          break;
        case 'arrowright':
          if (controlMode === 'freeLook') break;
          e.preventDefault();
          advance('right', carHeading);
          break;
        case 'a':
          if (controlMode === 'freeLook') {
            setHeading(prev => (prev - KEYBOARD_LOOK_RATE * 0.016 + 360) % 360);
          } else if (controlMode === 'carSteer') {
            applySteering(-KEYBOARD_STEER_RATE * 0.016);
          }
          break;
        case 'd':
          if (controlMode === 'freeLook') {
            setHeading(prev => (prev + KEYBOARD_LOOK_RATE * 0.016 + 360) % 360);
          } else if (controlMode === 'carSteer') {
            applySteering(KEYBOARD_STEER_RATE * 0.016);
          }
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
          const headYawOffset = (heading - carHeading + 540) % 360 - 180;
          if (Math.abs(headYawOffset) > 1 || Math.abs(pitch - 10) > 1) {
            setHeading(carHeading);
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
          onToggleHudRef.current?.();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
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

    return () => {
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
    heading,
    pitch,
    carHeading,
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
