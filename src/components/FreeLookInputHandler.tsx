import React, { useEffect, useRef } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useViewMode } from '../hooks/useViewMode';

interface FreeLookInputHandlerProps {
  targetRef: React.RefObject<HTMLElement | null>;
}

/**
 * FreeLookInputHandler - Handles all input events for free look mode.
 * 
 * Event handling strategy:
 * - mousedown/wheel/contextmenu: Scoped to target element
 * - mousemove/mouseup: Global (window) but guarded by isDragging
 * - keydown: Global with input element guard
 */
const FreeLookInputHandler: React.FC<FreeLookInputHandlerProps> = ({ targetRef }) => {
  const { heading, pitch, zoom, setHeading, setPitch, setZoom, advance } = useStreetView();
  const { toggleViewMode } = useViewMode();
  
  const isDraggingRef = useRef(false);
  const dragStartedOnTargetRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  
  // Sensitivity constants
  const PAN_SENSITIVITY = 0.1;
  const ZOOM_SENSITIVITY = 0.001;
  
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    
    // --- SCOPED EVENTS (attached to target) ---
    
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left click only
        isDraggingRef.current = true;
        dragStartedOnTargetRef.current = true;
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      }
    };
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Scroll up = zoom in (positive deltaY), scroll down = zoom out
      setZoom(prev => prev - e.deltaY * ZOOM_SENSITIVITY);
    };
    
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Right-click = move forward
      advance('forward');
    };
    
    // --- GLOBAL EVENTS (attached to window) ---
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartedOnTargetRef.current) return;
      
      const deltaX = e.movementX;
      const deltaY = e.movementY;
      
      // Update heading and pitch based on mouse movement
      setHeading(prev => prev + deltaX * PAN_SENSITIVITY);
      setPitch(prev => prev - deltaY * PAN_SENSITIVITY);
    };
    
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        isDraggingRef.current = false;
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
      
      switch (key) {
        case 'w':
          advance('forward');
          break;
        case 's':
          advance('backward');
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          advance('left');
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          advance('right');
          break;
        case 'arrowup':
          e.preventDefault();
          advance('forward');
          break;
        case 'arrowdown':
          e.preventDefault();
          advance('backward');
          break;
        case 'c':
          // Toggle to car mode
          toggleViewMode();
          break;
      }
    };
    
    // Attach scoped listeners to target
    target.addEventListener('mousedown', handleMouseDown);
    target.addEventListener('wheel', handleWheel, { passive: false });
    target.addEventListener('contextmenu', handleContextMenu);
    
    // Attach global listeners to window
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    
    // Cleanup
    return () => {
      target.removeEventListener('mousedown', handleMouseDown);
      target.removeEventListener('wheel', handleWheel);
      target.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [targetRef, setHeading, setPitch, setZoom, advance, toggleViewMode]);
  
  // This component doesn't render anything
  return null;
};

export default FreeLookInputHandler;
