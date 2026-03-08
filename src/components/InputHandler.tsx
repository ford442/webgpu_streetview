import React, { useEffect, useRef } from 'react';

interface InputHandlerProps {
    // Callbacks to notify the parent component of user actions
    onPan: (deltaX: number, deltaY: number) => void;
    onZoom: (deltaZ: number) => void;
    onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
    onRightClickMove: () => void; // Specific callback for right-click forward movement
    onToggleCarMode?: () => void; // Toggle car view with 'C' key
    onSteer?: (direction: 'left' | 'right', deltaTime: number) => void; // Steering for car mode (A/D keys)
    onRecenterHead?: () => void; // Recenter head look in car mode ('C' key when already in car mode)
    onMouseSteer?: (deltaX: number) => void; // Shift+drag car steering (horizontal mouse drag rotates car body)
    onToggleHeadCoupling?: () => void; // Toggle between rigid/free head coupling with 'H' key
    /** Hit-test function: returns true when the given screen point is over the steering wheel */
    isSteeringWheelAtPoint?: (x: number, y: number) => boolean;

    // State from the parent to control behavior
    isEnabled: boolean; // Controls whether the handler is active
    isCarMode?: boolean; // Whether car mode is active (affects A/D behavior)
    headCoupling?: 'rigid' | 'free'; // Current head coupling mode
    
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
    onRecenterHead,
    onMouseSteer,
    onToggleHeadCoupling,
    isSteeringWheelAtPoint,
    isEnabled,
    isCarMode = false,
    headCoupling = 'rigid', // Default to rigid (head turns with car)
    targetRef 
}) => {
    const isMouseDownRef = useRef(false);
    const dragDistanceRef = useRef(0);
    // Minimum total pixel movement to distinguish a drag from a click
    const CLICK_DRAG_THRESHOLD = 5;
    // Track if the current drag operation started on the target element
    const dragStartedOnTargetRef = useRef(false);
    // Track if Shift was held when the current drag started (for Shift+drag car steering)
    const isShiftDragRef = useRef(false);
    // Track if the drag started on the steering wheel (for steering wheel click-to-steer)
    const isSteeringWheelDragRef = useRef(false);
    // Track middle mouse button for dedicated free look
    const isMiddleMouseRef = useRef(false);

    // Refs to store the latest versions of callbacks to prevent useEffect thrashing
    const onPanRef = useRef(onPan);
    const onZoomRef = useRef(onZoom);
    const onMoveRef = useRef(onMove);
    const onRightClickMoveRef = useRef(onRightClickMove);
    const onToggleCarModeRef = useRef(onToggleCarMode);
    const onSteerRef = useRef(onSteer);
    const onRecenterHeadRef = useRef(onRecenterHead);
    const onMouseSteerRef = useRef(onMouseSteer);
    const onToggleHeadCouplingRef = useRef(onToggleHeadCoupling);
    const isCarModeRef = useRef(isCarMode);
    const headCouplingRef = useRef(headCoupling);
    const isSteeringWheelAtPointRef = useRef(isSteeringWheelAtPoint);

    // Track keys pressed for continuous steering
    const keysPressedRef = useRef<Set<string>>(new Set());
    const lastTimeRef = useRef<number>(0);
    const steerAnimationRef = useRef<number>(0);
    // Throttle the steering-wheel hover hit-test to ~20/s to avoid excessive raycasting
    const lastHitTestTimeRef = useRef<number>(0);

    // Keep refs up to date
    useEffect(() => {
        onPanRef.current = onPan;
        onZoomRef.current = onZoom;
        onMoveRef.current = onMove;
        onRightClickMoveRef.current = onRightClickMove;
        onToggleCarModeRef.current = onToggleCarMode;
        onSteerRef.current = onSteer;
        onRecenterHeadRef.current = onRecenterHead;
        onMouseSteerRef.current = onMouseSteer;
        onToggleHeadCouplingRef.current = onToggleHeadCoupling;
        isCarModeRef.current = isCarMode;
        headCouplingRef.current = headCoupling;
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
                // Capture shift key state at drag start for Shift+drag car steering
                isShiftDragRef.current = e.shiftKey;
                // Detect steering wheel click in car mode for click-to-steer behaviour
                isSteeringWheelDragRef.current = isCarModeRef.current
                    && !!isSteeringWheelAtPointRef.current?.(e.clientX, e.clientY);
                isMiddleMouseRef.current = false;
            } else if (e.button === 1) { // Middle mouse button - FREE LOOK only
                isMouseDownRef.current = true;
                dragStartedOnTargetRef.current = true;
                dragDistanceRef.current = 0;
                isMiddleMouseRef.current = true;
                isSteeringWheelDragRef.current = false;
                isShiftDragRef.current = false;
                e.preventDefault(); // Prevent scroll behavior
            }
        };

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            onZoomRef.current(e.deltaY);
        };

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            onRightClickMoveRef.current();
        };

        // --- GLOBAL MOUSE EVENTS (attached to window) ---
        // These are kept global so dragging continues smoothly even if cursor leaves element
        
        const handleMouseUp = (e: MouseEvent) => {
            if (e.button === 0 || e.button === 1) { // Left or middle mouse button
                // Capture flags before resetting them
                const wasSteeringWheelDrag = isSteeringWheelDragRef.current;
                const wasShiftDrag = isShiftDragRef.current;
                const wasMiddleMouse = isMiddleMouseRef.current;

                isMouseDownRef.current = false;
                isSteeringWheelDragRef.current = false;
                isShiftDragRef.current = false;
                isMiddleMouseRef.current = false;
                // Restore cursor
                if (target) (target as HTMLElement).style.cursor = '';
                
                // Only trigger click-to-move on left click (not middle)
                if (dragStartedOnTargetRef.current && dragDistanceRef.current < CLICK_DRAG_THRESHOLD
                        && !wasSteeringWheelDrag && !wasShiftDrag && !wasMiddleMouse) {
                    onMoveRef.current('forward');
                }
                
                dragStartedOnTargetRef.current = false;
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            // Update cursor to hint that the steering wheel is interactive in car mode
            if (!isMouseDownRef.current && target && isCarModeRef.current && isSteeringWheelAtPointRef.current) {
                const now = performance.now();
                if (now - lastHitTestTimeRef.current > 50) { // Max ~20 tests/s
                    lastHitTestTimeRef.current = now;
                    const onWheel = isSteeringWheelAtPointRef.current(e.clientX, e.clientY);
                    (target as HTMLElement).style.cursor = onWheel ? 'grab' : '';
                }
            }

            // Only process pan if a drag operation actually started on the target
            if (isMouseDownRef.current && dragStartedOnTargetRef.current) {
                const dist = Math.hypot(e.movementX, e.movementY);
                dragDistanceRef.current += dist;

                // MIDDLE MOUSE = Free look only (always)
                if (isMiddleMouseRef.current) {
                    onPanRef.current(e.movementX, e.movementY);
                }
                // Steering wheel drag = car steering
                else if (isSteeringWheelDragRef.current && onMouseSteerRef.current) {
                    // Set cursor to 'grabbing' while dragging steering wheel
                    if (target) (target as HTMLElement).style.cursor = 'grabbing';
                    onMouseSteerRef.current(e.movementX);
                }
                // Shift+drag = car steering (plus head pitch in free mode)
                else if (isCarModeRef.current && isShiftDragRef.current && onMouseSteerRef.current) {
                    onMouseSteerRef.current(e.movementX);
                    // In free coupling mode, also allow head pitch change
                    if (headCouplingRef.current === 'free') {
                        onPanRef.current(0, e.movementY);
                    }
                }
                // Normal drag = free look
                else {
                    onPanRef.current(e.movementX, e.movementY);
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
                case 'c':
                    // Long press C for recenter, short press for toggle
                    if (isCarModeRef.current) {
                        onRecenterHeadRef.current?.();
                    } else {
                        onToggleCarModeRef.current?.();
                    }
                    break;
                case 'h': // Toggle head coupling mode
                    if (isCarModeRef.current) {
                        onToggleHeadCouplingRef.current?.();
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
