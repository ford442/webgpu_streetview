import React, { useEffect, useRef, useCallback } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useViewMode, ControlMode } from '../hooks/useViewMode';

interface CarInputHandlerProps {
  targetRef: React.RefObject<HTMLElement | null>;
  isSteeringWheelAtPoint?: (x: number, y: number) => boolean;
  onThrust?: (direction: 'forward' | 'backward') => void;
  onSteeringDelta?: (delta: number) => void;
}

/**
 * CarInputHandler - Handles all input events for car mode.
 * 
 * Routes input based on controlMode:
 * - freeLook: All mouse drag = head look only (car body never steers), A/D = head rotate
 * - uiMouse: Mouse = UI only, right-drag = steer
 * - carSteer: Mouse X = steer, A/D = steer, Q/E = snap steer
 * 
 * Event handling strategy:
 * - mousedown/wheel/contextmenu: Scoped to target element
 * - mousemove/mouseup: Global (window) but guarded by isDragging
 * - keydown: Global with input element guard
 */
const CarInputHandler: React.FC<CarInputHandlerProps> = ({
  targetRef,
  isSteeringWheelAtPoint,
  onThrust,
  onSteeringDelta
}) => {
  const {
    heading,
    pitch,
    setHeading,
    setPitch,
    advance
  } = useStreetView();
  
  const {
    viewMode,
    toggleViewMode,
    controlMode,
    toggleControlMode,
    headCoupling,
    setHeadCoupling,
    startTempSteerMode,
    endTempSteerMode,
    carHeading,
    setCarHeading,
  } = useViewMode();
  
  // Drag and input state
  const isDraggingRef = useRef(false);
  const isSteeringWheelDragRef = useRef(false);
  const isRightMouseRef = useRef(false);
  const dragStartedOnTargetRef = useRef(false);
  
  const keysPressedRef = useRef<Set<string>>(new Set());
  const lastTimeRef = useRef<number>(0);

  // Constants
  const HEAD_LOOK_SENSITIVITY = 0.18;
  const KEYBOARD_LOOK_RATE = 120; // degrees per second for head rotation
  const KEYBOARD_STEER_RATE = 60; // degrees per second for car steering
  const CLICK_DRAG_THRESHOLD = 5;
  
  // Steering helper
  const applySteering = useCallback((steerDelta: number) => {
    // Move the car body heading
    setCarHeading(prev => ((prev + steerDelta + 360) % 360));

    // Rigid coupling means the head turns with the car body
    if (headCoupling === 'rigid') {
      setHeading(prev => (prev + steerDelta + 360) % 360);
    }
    // In 'free' coupling, setHeading is NOT called, so the head stays
    // fixed to its current world-absolute heading.

    // Notify parent of steering delta for steering wheel visual / body tilt
    onSteeringDelta?.(steerDelta * 0.5);
  }, [headCoupling, setCarHeading, setHeading, onSteeringDelta]);
  
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    
    // Get effective control mode (respect temporary mode switch)
    const getEffectiveControlMode = (): ControlMode => {
      // The temporary mode is handled by the context, we just read controlMode
      return controlMode;
    };
    
    // --- SCOPED EVENTS (attached to target) ---
    
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left click
        isDraggingRef.current = true;
        dragStartedOnTargetRef.current = true;
        
        // Check if clicking on steering wheel
        const onWheel = !!isSteeringWheelAtPoint?.(e.clientX, e.clientY);
        isSteeringWheelDragRef.current = onWheel;
        
        // In freeLook mode, clicking wheel enters temporary carSteer mode
        if (getEffectiveControlMode() === 'freeLook' && onWheel) {
          startTempSteerMode();
        }
        
        isRightMouseRef.current = false;
      } else if (e.button === 2) { // Right click - steering
        isDraggingRef.current = true;
        dragStartedOnTargetRef.current = true;
        isRightMouseRef.current = true;
        isSteeringWheelDragRef.current = false;
      }
    };
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Zoom is handled by scroll in car mode too
      // We'll emit an event or callback here if needed
    };
    
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Right-click handled in mouse down
    };
    
    // --- GLOBAL EVENTS (attached to window) ---
    
    const handleMouseMove = (e: MouseEvent) => {
      const currentMode = getEffectiveControlMode();
      
      if (!isDraggingRef.current || !dragStartedOnTargetRef.current) return;
      
      const isSteeringDrag = isSteeringWheelDragRef.current || isRightMouseRef.current;
      
      if (currentMode === 'freeLook') {
        // Free Look: all mouse drag controls head look only — car body never steers
        setHeading(prev => (prev + e.movementX * HEAD_LOOK_SENSITIVITY + 360) % 360);
        setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
      } else if (currentMode === 'carSteer') {
        // Car Steer Mode: All mouse drags steer the car body
        applySteering(e.movementX * 0.3);
        setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
      } else if (currentMode === 'uiMouse') {
        // UI Mouse: Mouse drag is primarily for UI
        // But Right-click drag still allows steering
        if (isRightMouseRef.current) {
          applySteering(e.movementX * 0.3);
        }
      }
    };
    
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) {
        // If we were in temp steer mode from wheel, end it
        if (e.button === 0 && isSteeringWheelDragRef.current) {
          endTempSteerMode();
        }
        
        isDraggingRef.current = false;
        isSteeringWheelDragRef.current = false;
        isRightMouseRef.current = false;
        dragStartedOnTargetRef.current = false;
      }
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard: Don't trigger when typing in input elements
      if (document.activeElement instanceof HTMLInputElement || 
          document.activeElement instanceof HTMLTextAreaElement) {
        return;
      }
      
      const key = e.key.toLowerCase();
      keysPressedRef.current.add(key);
      
      switch (key) {
        case 'w':
          if (controlMode === 'freeLook') break;
          advance('forward', carHeading);
          onThrust?.('forward');
          break;
        case 's':
          if (controlMode === 'freeLook') break;
          advance('backward', carHeading);
          onThrust?.('backward');
          break;
        case 'arrowup':
          e.preventDefault();
          if (controlMode === 'freeLook') break;
          advance('forward', carHeading);
          onThrust?.('forward');
          break;
        case 'arrowdown':
          e.preventDefault();
          if (controlMode === 'freeLook') break;
          advance('backward', carHeading);
          onThrust?.('backward');
          break;
        case 'arrowleft':
          e.preventDefault();
          if (controlMode === 'freeLook') break;
          advance('left', carHeading);
          break;
        case 'arrowright':
          e.preventDefault();
          if (controlMode === 'freeLook') break;
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
          if (controlMode === 'carSteer') {
            applySteering(-45);
          }
          break;
        case 'e':
          e.preventDefault();
          if (controlMode === 'carSteer') {
            applySteering(45);
          }
          break;
        case 'c':
          // Recenter head look to car body if offset; otherwise toggle car mode
          const headYawOffset = (heading - carHeading + 540) % 360 - 180;
          if (Math.abs(headYawOffset) > 1 || Math.abs(pitch - 10) > 1) {
            setHeading(carHeading);
            setPitch(10); // Default pitch
          } else {
            toggleViewMode();
          }
          break;
        case 'h':
          // Toggle control mode
          toggleControlMode();
          break;
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressedRef.current.delete(e.key.toLowerCase());
      keysPressedRef.current.delete(e.key);
    };
    
    // Attach scoped listeners to target
    target.addEventListener('mousedown', handleMouseDown);
    target.addEventListener('wheel', handleWheel, { passive: false });
    target.addEventListener('contextmenu', handleContextMenu);
    
    // Attach global listeners to window
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Cleanup
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
    advance,
    toggleViewMode,
    toggleControlMode,
    startTempSteerMode,
    endTempSteerMode,
    setCarHeading,
    applySteering,
    onSteeringDelta,
  ]);
  
  // This component doesn't render anything
  return null;
};

export default CarInputHandler;
