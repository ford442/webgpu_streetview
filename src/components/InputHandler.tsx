import React, { useEffect, useRef } from 'react';

interface InputHandlerProps {
    // Callbacks to notify the parent component of user actions
    onPan: (deltaX: number, deltaY: number) => void;
    onZoom: (deltaZ: number) => void;
    onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
    onRightClickMove: () => void; // Specific callback for right-click forward movement
    onToggleCarMode?: () => void; // Toggle car view with 'C' key
    onSteer?: (direction: 'left' | 'right', deltaTime: number) => void; // Steering for car mode (A/D keys)
    onSteerDrag?: (deltaX: number) => void; // Mouse drag steering (drive mode / wheel grab)
    onRecenterHead?: () => void; // Recenter head look in car mode ('C' key when already in car mode)
    onToggleControlMode?: () => void; // Toggle between control modes with 'H' key
    onSnapTurn?: (direction: 'left' | 'right') => void; // Q/E snap turns
    onSteeringWheelClick?: (isDown: boolean) => void; // Steering wheel click (temp mode switch)
    /** Hit-test function: returns true when the given screen point is over the steering wheel.
     *  Clicks there trigger temporary mode switch to carSteer in freeLook mode. */
    isSteeringWheelAtPoint?: (x: number, y: number) => boolean;

    // State from the parent to control behavior
    isEnabled: boolean; // Controls whether the handler is active
    isCarMode?: boolean; // Whether car mode is active (affects A/D behavior)
    controlMode?: 'freeLook' | 'uiMouse' | 'carSteer'; // Control mode
    
    // Target element for scoped mouse events
    targetRef: React.RefObject<HTMLElement | null>;
}

const InputHandler: React.FC<InputHandlerProps> = ({ 
    onPan, 
    onZoom, 
    onMove, 
    onRightClickMove,
    onToggleCarMode,
    onSteer,
    onSteerDrag,
    onRecenterHead,
    onToggleControlMode,
    onSnapTurn,
    onSteeringWheelClick,
    isSteeringWheelAtPoint,
    isEnabled,
    isCarMode = false,
    controlMode = 'freeLook',
    targetRef 
}) => {
    const isMouseDownRef = useRef(false);
    const dragDistanceRef = useRef(0);
    // Minimum total pixel movement to distinguish a drag from a click
    const CLICK_DRAG_THRESHOLD = 5;
    // Track if the current drag operation started on the target element
    const dragStartedOnTargetRef = useRef(false);
    // Track if the drag started on the steering wheel
    const isSteeringWheelDragRef = useRef(false);
    // Track middle mouse button for dedicated free look
    const isMiddleMouseRef = useRef(false);
    // Track right mouse button for steering in cab mode
    const isRightMouseRef = useRef(false);
    // Track if we're currently in a drag (for preventing click-to-move)
    const isDraggingRef = useRef(false);
    // Track if we're in a temporary mode switch from steering wheel
    const isTempSteerModeRef = useRef(false);

    // Refs to store the latest versions of callbacks to prevent useEffect thrashing
    const onPanRef = useRef(onPan);
    const onZoomRef = useRef(onZoom);
    const onMoveRef = useRef(onMove);
    const onRightClickMoveRef = useRef(onRightClickMove);
    const onToggleCarModeRef = useRef(onToggleCarMode);
    const onSteerRef = useRef(onSteer);
    const onSteerDragRef = useRef(onSteerDrag);
    const onRecenterHeadRef = useRef(onRecenterHead);
    const onToggleControlModeRef = useRef(onToggleControlMode);
    const onSnapTurnRef = useRef(onSnapTurn);
    const onSteeringWheelClickRef = useRef(onSteeringWheelClick);
    const isCarModeRef = useRef(isCarMode);
    const controlModeRef = useRef(controlMode);
    const isSteeringWheelAtPointRef = useRef(isSteeringWheelAtPoint);

    // Track keys pressed for continuous steering
    const keysPressedRef = useRef<Set<string>>(new Set());
    const lastTimeRef = useRef<number>(0);
    const steerAnimationRef = useRef<number>(0);
    // Keep refs up to date
    useEffect(() => {
        onPanRef.current = onPan;
        onZoomRef.current = onZoom;
        onMoveRef.current = onMove;
        onRightClickMoveRef.current = onRightClickMove;
        onToggleCarModeRef.current = onToggleCarMode;
        onSteerRef.current = onSteer;
        onSteerDragRef.current = onSteerDrag;
        onRecenterHeadRef.current = onRecenterHead;
        onToggleControlModeRef.current = onToggleControlMode;
        onSnapTurnRef.current = onSnapTurn;
        onSteeringWheelClickRef.current = onSteeringWheelClick;
        isCarModeRef.current = isCarMode;
        controlModeRef.current = controlMode;
        isSteeringWheelAtPointRef.current = isSteeringWheelAtPoint;
    });

    useEffect(() => {
        if (!isEnabled) return;
        
        const target = targetRef.current;
        if (!target) return;

        // --- SCOPED MOUSE EVENTS (attached to target) ---
        
        const handleMouseDown = (e: MouseEvent) => {
            if (e.button === 0) { // Left mouse button
                isMouseDownRef.current = true;
                dragStartedOnTargetRef.current = true;
                dragDistanceRef.current = 0;
                isDraggingRef.current = false;
                
                // Check if clicking on steering wheel
                const onWheel = isCarModeRef.current && !!isSteeringWheelAtPointRef.current?.(e.clientX, e.clientY);
                isSteeringWheelDragRef.current = onWheel;
                
                // In freeLook mode, clicking wheel enters temporary carSteer mode
                if (controlModeRef.current === 'freeLook' && onWheel && onSteeringWheelClickRef.current) {
                    isTempSteerModeRef.current = true;
                    onSteeringWheelClickRef.current(true);
                }
                
                isMiddleMouseRef.current = false;
            } else if (e.button === 1) { // Middle mouse button - FREE LOOK only
                isMouseDownRef.current = true;
                dragStartedOnTargetRef.current = true;
                dragDistanceRef.current = 0;
                isDraggingRef.current = false;
                isMiddleMouseRef.current = true;
                isRightMouseRef.current = false;
                isSteeringWheelDragRef.current = false;
                e.preventDefault(); // Prevent scroll behavior
            } else if (e.button === 2) { // Right mouse button - STEERING
                isMouseDownRef.current = true;
                dragStartedOnTargetRef.current = true;
                dragDistanceRef.current = 0;
                isDraggingRef.current = false;
                isRightMouseRef.current = true;
                isMiddleMouseRef.current = false;
                isSteeringWheelDragRef.current = false;
            }
        };

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            onZoomRef.current(e.deltaY);
        };

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            // In car mode, right-click is steering - skip move action
            if (isCarModeRef.current) return;
            onRightClickMoveRef.current();
        };

        // --- GLOBAL MOUSE EVENTS (attached to window) ---
        // These are kept global so dragging continues smoothly even if cursor leaves element
        
        const handleMouseUp = (e: MouseEvent) => {
            if (e.button === 0 || e.button === 1 || e.button === 2) {
                // Capture flags before resetting them
                const wasSteeringWheelDrag = isSteeringWheelDragRef.current;
                const wasMiddleMouse = isMiddleMouseRef.current;
                const wasRightMouse = isRightMouseRef.current;
                const wasDragging = isDraggingRef.current;

                // If we were in temp steer mode from wheel, notify parent to restore mode
                if (e.button === 0 && isTempSteerModeRef.current && onSteeringWheelClickRef.current) {
                    onSteeringWheelClickRef.current(false);
                    isTempSteerModeRef.current = false;
                }

                isMouseDownRef.current = false;
                isSteeringWheelDragRef.current = false;
                isMiddleMouseRef.current = false;
                isRightMouseRef.current = false;
                isDraggingRef.current = false;
                // Restore cursor
                if (target) (target as HTMLElement).style.cursor = '';

                // Only trigger click-to-move on left click (not middle/right) and if we weren't dragging significantly
                // In uiMouse mode, never trigger click-to-move from canvas click
                if (e.button === 0 && dragStartedOnTargetRef.current && !wasDragging
                        && !wasSteeringWheelDrag && !wasMiddleMouse && !wasRightMouse
                        && controlModeRef.current !== 'uiMouse') {
                    onMoveRef.current('forward');
                }

                dragStartedOnTargetRef.current = false;
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            const movementX = e.movementX;
            const movementY = e.movementY;

            // Track drag distance when mouse is down
            if (isMouseDownRef.current && dragStartedOnTargetRef.current) {
                const dist = Math.hypot(movementX, movementY);
                dragDistanceRef.current += dist;
                // Mark as dragging if we've moved enough
                if (dragDistanceRef.current > CLICK_DRAG_THRESHOLD) {
                    isDraggingRef.current = true;
                }
            }

            // In non-car mode, mouse movement only affects view when dragging
            if (!isCarModeRef.current) {
                if (isMouseDownRef.current && dragStartedOnTargetRef.current) {
                    onPanRef.current(movementX, movementY);
                }
                return;
            }

            // --- CAR MODE INPUT HANDLING ---
            const currentMode = isTempSteerModeRef.current ? 'carSteer' : controlModeRef.current;

            if (currentMode === 'freeLook') {
                // Free Look: mouse always controls head look
                // Steering is done via: wheel grab, Shift+mouse, right-drag, or A/D keys
                const isSteeringDrag = isMouseDownRef.current && (isSteeringWheelDragRef.current || isRightMouseRef.current);
                
                if (isSteeringDrag && onSteerDragRef.current) {
                    // Steering via wheel grab or right-drag
                    onSteerDragRef.current(movementX);
                    // Vertical movement still affects head pitch
                    onPanRef.current(0, movementY);
                } else if (e.shiftKey && onSteerDragRef.current) {
                    // Shift + mouse = steering
                    onSteerDragRef.current(movementX);
                    onPanRef.current(0, movementY);
                } else {
                    // Normal head look - always active
                    onPanRef.current(movementX, movementY);
                }
            } else if (currentMode === 'uiMouse') {
                // UI Mouse: no view control from mouse
                // Steering only via A/D keys (handled in steer loop)
                // But if right-dragging, that still steers
                if (isRightMouseRef.current && onSteerDragRef.current) {
                    onSteerDragRef.current(movementX);
                }
            } else if (currentMode === 'carSteer') {
                // Car Steer: mouse X steers, Y controls pitch
                if (onSteerDragRef.current) {
                    onSteerDragRef.current(movementX);
                }
                onPanRef.current(0, movementY);
            }
        };

        // --- KEYBOARD EVENTS (global but with input guard) ---
        
        const handleKeyDown = (e: KeyboardEvent) => {
            // Guard: Don't trigger navigation when typing in input elements
            if (document.activeElement instanceof HTMLInputElement || 
                document.activeElement instanceof HTMLTextAreaElement) {
                return;
            }
            
            const key = e.key.toLowerCase();
            keysPressedRef.current.add(key);
            
            switch (key) {
                case 'w':
                    onMoveRef.current('forward');
                    break;
                case 's':
                    onMoveRef.current('backward');
                    break;
                case 'arrowup':
                    e.preventDefault(); // Prevent page scroll
                    onMoveRef.current('forward');
                    break;
                case 'arrowdown':
                    e.preventDefault(); // Prevent page scroll
                    onMoveRef.current('backward');
                    break;
                case 'arrowleft':
                    e.preventDefault(); // Prevent page scroll
                    onMoveRef.current('left');
                    break;
                case 'arrowright':
                    e.preventDefault(); // Prevent page scroll
                    onMoveRef.current('right');
                    break;
                case 'q':
                    e.preventDefault();
                    onSnapTurnRef.current?.('left');
                    break;
                case 'e':
                    e.preventDefault();
                    onSnapTurnRef.current?.('right');
                    break;
                case 'c':
                    // Long press C for recenter, short press for toggle
                    if (isCarModeRef.current) {
                        onRecenterHeadRef.current?.();
                    } else {
                        onToggleCarModeRef.current?.();
                    }
                    break;
                case 'h': // Toggle control mode
                    if (isCarModeRef.current) {
                        onToggleControlModeRef.current?.();
                    }
                    break;
            }
            // A/D keys are handled in the animation loop for continuous steering
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressedRef.current.delete(e.key.toLowerCase());
            keysPressedRef.current.delete(e.key); // Handle arrow keys too
        };

        // --- CONTINUOUS STEERING LOOP (for smooth A/D steering in car mode) ---
        const steerLoop = (timestamp: number) => {
            if (!isCarModeRef.current || !onSteerRef.current) {
                lastTimeRef.current = timestamp;
                steerAnimationRef.current = requestAnimationFrame(steerLoop);
                return;
            }

            const deltaTime = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0;
            lastTimeRef.current = timestamp;

            const keys = keysPressedRef.current;
            const isLeft = keys.has('a');
            const isRight = keys.has('d');

            if (isLeft && !isRight) {
                onSteerRef.current('left', deltaTime);
            } else if (isRight && !isLeft) {
                onSteerRef.current('right', deltaTime);
            }

            steerAnimationRef.current = requestAnimationFrame(steerLoop);
        };

        // Start steering loop
        steerAnimationRef.current = requestAnimationFrame(steerLoop);

        // Attach scoped listeners to target element
        target.addEventListener('mousedown', handleMouseDown);
        target.addEventListener('wheel', handleWheel, { passive: false });
        target.addEventListener('contextmenu', handleContextMenu);
        
        // Attach global listeners to window
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        // Cleanup
        return () => {
            // Remove scoped listeners from target
            target.removeEventListener('mousedown', handleMouseDown);
            target.removeEventListener('wheel', handleWheel);
            target.removeEventListener('contextmenu', handleContextMenu);
            
            // Remove global listeners from window
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            
            // Reset cursor
            (target as HTMLElement).style.cursor = '';
            
            // Cancel steering loop
            cancelAnimationFrame(steerAnimationRef.current);
        };
    }, [isEnabled, targetRef]);

    return null; // This component does not render anything
};

export default InputHandler;
