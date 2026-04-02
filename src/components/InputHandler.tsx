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
    onToggleCarControlMode?: () => void; // Toggle between cab/drive mode with 'H' key
    onSnapTurn?: (direction: 'left' | 'right') => void; // Q/E snap turns
    /** Hit-test function: returns true when the given screen point is over the steering wheel.
     *  Clicks there are ignored for click-to-move so dragging the in-car UI does not move forward. */
    isSteeringWheelAtPoint?: (x: number, y: number) => boolean;

    // State from the parent to control behavior
    isEnabled: boolean; // Controls whether the handler is active
    isCarMode?: boolean; // Whether car mode is active (affects A/D behavior)
    carControlMode?: 'cab' | 'drive'; // Car control mode
    
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
    onToggleCarControlMode,
    onSnapTurn,
    isSteeringWheelAtPoint,
    isEnabled,
    isCarMode = false,
    carControlMode = 'cab',
    targetRef 
}) => {
    const isMouseDownRef = useRef(false);
    const dragDistanceRef = useRef(0);
    // Minimum total pixel movement to distinguish a drag from a click
    const CLICK_DRAG_THRESHOLD = 5;
    // Track if the current drag operation started on the target element
    const dragStartedOnTargetRef = useRef(false);
    // Track if the drag started on the steering wheel so clicks there don't trigger forward movement
    const isSteeringWheelDragRef = useRef(false);
    // Track middle mouse button for dedicated free look
    const isMiddleMouseRef = useRef(false);
    // Track right mouse button for steering in cab mode
    const isRightMouseRef = useRef(false);
    // Track if we're currently in a drag (for preventing click-to-move)
    const isDraggingRef = useRef(false);

    // Refs to store the latest versions of callbacks to prevent useEffect thrashing
    const onPanRef = useRef(onPan);
    const onZoomRef = useRef(onZoom);
    const onMoveRef = useRef(onMove);
    const onRightClickMoveRef = useRef(onRightClickMove);
    const onToggleCarModeRef = useRef(onToggleCarMode);
    const onSteerRef = useRef(onSteer);
    const onSteerDragRef = useRef(onSteerDrag);
    const onRecenterHeadRef = useRef(onRecenterHead);
    const onToggleCarControlModeRef = useRef(onToggleCarControlMode);
    const onSnapTurnRef = useRef(onSnapTurn);
    const isCarModeRef = useRef(isCarMode);
    const carControlModeRef = useRef(carControlMode);
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
        onToggleCarControlModeRef.current = onToggleCarControlMode;
        onSnapTurnRef.current = onSnapTurn;
        isCarModeRef.current = isCarMode;
        carControlModeRef.current = carControlMode;
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
                // Detect steering wheel clicks so they can be ignored for click-to-move.
                isSteeringWheelDragRef.current = isCarModeRef.current
                    && !!isSteeringWheelAtPointRef.current?.(e.clientX, e.clientY);
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
            } else if (e.button === 2) { // Right mouse button - STEERING in cab mode
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
            // In car cab mode, right-click is used for steering drag — skip move action
            if (isCarModeRef.current && carControlModeRef.current === 'cab') return;
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

                isMouseDownRef.current = false;
                isSteeringWheelDragRef.current = false;
                isMiddleMouseRef.current = false;
                isRightMouseRef.current = false;
                isDraggingRef.current = false;
                // Restore cursor
                if (target) (target as HTMLElement).style.cursor = '';

                // Only trigger click-to-move on left click (not middle/right) and if we weren't dragging significantly
                if (e.button === 0 && dragStartedOnTargetRef.current && !wasDragging
                        && !wasSteeringWheelDrag && !wasMiddleMouse && !wasRightMouse) {
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

            // --- FREE LOOK LOGIC ---
            // In car mode (cab mode), mouse ALWAYS controls head look, even without clicking.
            // Steering is done via: steering wheel grab, Shift+mouse, or right-click drag.
            if (isCarModeRef.current && carControlModeRef.current === 'cab') {
                const isSteeringDrag = isMouseDownRef.current && isSteeringWheelDragRef.current;
                const isRightDrag = isMouseDownRef.current && isRightMouseRef.current;

                if (isSteeringDrag && onSteerDragRef.current) {
                    // Steering wheel grab mode - drag controls steering
                    onSteerDragRef.current(movementX);
                    onPanRef.current(0, movementY);
                } else if (isRightDrag && onSteerDragRef.current) {
                    // Right-click drag = steering
                    onSteerDragRef.current(movementX);
                    onPanRef.current(0, movementY);
                } else if (e.shiftKey && onSteerDragRef.current) {
                    // Shift + mouse movement = steering
                    onSteerDragRef.current(movementX);
                    onPanRef.current(0, movementY);
                } else {
                    // Normal head look - always active (full 360° free look)
                    onPanRef.current(movementX, movementY);
                }
                return;
            }

            // --- DRIVE MODE or NON-CAR MODE ---
            // Mouse movement only affects view when dragging (holding mouse down)
            if (isMouseDownRef.current && dragStartedOnTargetRef.current) {
                // MIDDLE MOUSE = Free look only (always)
                if (isMiddleMouseRef.current) {
                    onPanRef.current(movementX, movementY);
                    return;
                }

                // In drive mode, horizontal drag steers
                if (isCarModeRef.current && carControlModeRef.current === 'drive' && onSteerDragRef.current) {
                    onSteerDragRef.current(movementX);
                    // Vertical drag controls pitch
                    onPanRef.current(0, movementY);
                } else {
                    // Free mode: normal look
                    onPanRef.current(movementX, movementY);
                }
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
                case 'h': // Toggle cab/drive mode
                    if (isCarModeRef.current) {
                        onToggleCarControlModeRef.current?.();
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
