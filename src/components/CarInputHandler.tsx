import React, { useEffect, useRef } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useViewMode, ControlMode } from '../hooks/useViewMode';

interface CarInputHandlerProps {
  targetRef: React.RefObject<HTMLElement | null>;
  isSteeringWheelAtPoint?: (x: number, y: number) => boolean;
}

/**
 * CarInputHandler - Handles all input events for car mode.
 * 
 * Routes input based on controlMode:
 * - freeLook: Mouse drag = head look, wheel click = temp steer, A/D = steer
 * - uiMouse: Mouse = UI only, A/D = steer
 * - carSteer: Mouse X = steer, Mouse Y = pitch
 * 
 * Event handling strategy:
 * - mousedown/wheel/contextmenu: Scoped to target element
 * - mousemove/mouseup: Global (window) but guarded by isDragging
 * - keydown: Global with input element guard
 */
const CarInputHandler: React.FC<CarInputHandlerProps> = ({
  targetRef,
  isSteeringWheelAtPoint
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
    endTempSteerMode
  } = useViewMode();
  
  // Drag and input state
  const isDraggingRef = useRef(false);
  const isSteeringWheelDragRef = useRef(false);
  const isRightMouseRef = useRef(false);
  const dragStartedOnTargetRef = useRef(false);
  
  // Car steering state (to be passed to parent or context)
  const steeringInputRef = useRef(0);
  const keysPressedRef = useRef<Set<string>>(new Set());
  const lastTimeRef = useRef<number>(0);
  
  // Constants
  const HEAD_LOOK_SENSITIVITY = 0.18;
  const KEYBOARD_STEER_RATE = 60; // degrees per second
  const CLICK_DRAG_THRESHOLD = 5;
  
  // Steering helper
  const applySteering = (steerDelta: number) => {
    // Update steering angle for UI
    const newSteering = Math.max(-90, Math.min(90, steeringInputRef.current + steerDelta * 0.5));
    steeringInputRef.current = newSteering;
    
    // In free head coupling, compensate head yaw so driver keeps looking at same world direction
    if (headCoupling === 'free') {
      setHeading(prev => {
        let next = prev - steerDelta;
        // Wrap to ±180°
        if (next > 180) next -= 360;
        if (next < -180) next += 360;
        return next;
      });
    }
  };
  
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
      
      // Track drag distance
      if (isDraggingRef.current && dragStartedOnTargetRef.current) {
        const dist = Math.hypot(e.movementX, e.movementY);
        if (dist > CLICK_DRAG_THRESHOLD) {
          // Mark as dragging
        }
      }
      
      if (!isDraggingRef.current || !dragStartedOnTargetRef.current) return;
      
      const isSteeringDrag = isSteeringWheelDragRef.current || isRightMouseRef.current;
      
      if (currentMode === 'freeLook') {
        // Free Look: mouse drag controls head look
        // Steering is done via: wheel grab, Shift+drag, right-drag, or A/D keys
        if (isSteeringDrag) {
          // Steering via wheel grab or right-drag
          applySteering(e.movementX * 0.3);
          // Vertical movement still affects head pitch
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        } else if (e.shiftKey) {
          // Shift+drag = steering
          applySteering(e.movementX * 0.3);
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        } else {
          // Normal head look
          setHeading(prev => {
            let next = prev + e.movementX * HEAD_LOOK_SENSITIVITY;
            if (next > 180) next -= 360;
            if (next < -180) next += 360;
            return next;
          });
          setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
        }
      } else if (currentMode === 'uiMouse') {
        // UI Mouse: no view control from mouse
        // But if right-dragging, that still steers
        if (isRightMouseRef.current) {
          applySteering(e.movementX * 0.3);
        }
      } else if (currentMode === 'carSteer') {
        // Car Steer: mouse drag X steers, Y controls pitch
        applySteering(e.movementX * 0.3);
        setPitch(prev => Math.max(-45, Math.min(65, prev - e.movementY * HEAD_LOOK_SENSITIVITY)));
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
          advance('forward');
          break;
        case 's':
          advance('backward');
          break;
        case 'arrowup':
          e.preventDefault();
          advance('forward');
          break;
        case 'arrowdown':
          e.preventDefault();
          advance('backward');
          break;
        case 'arrowleft':
          e.preventDefault();
          advance('left');
          break;
        case 'arrowright':
          e.preventDefault();
          advance('right');
          break;
        case 'a':
          // Steering left
          applySteering(-KEYBOARD_STEER_RATE * 0.016); // Approx for one frame
          break;
        case 'd':
          // Steering right
          applySteering(KEYBOARD_STEER_RATE * 0.016);
          break;
        case 'q':
          e.preventDefault();
          // Snap turn left
          applySteering(-45);
          break;
        case 'e':
          e.preventDefault();
          // Snap turn right
          applySteering(45);
          break;
        case 'c':
          // In car mode, C recenters head or exits if long press (simplified: just exit)
          toggleViewMode();
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
    setHeading,
    setPitch,
    advance,
    toggleViewMode,
    toggleControlMode,
    startTempSteerMode,
    endTempSteerMode
  ]);
  
  // This component doesn't render anything
  return null;
};

export default CarInputHandler;
