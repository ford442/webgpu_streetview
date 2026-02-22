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

    // State from the parent to control behavior
    isEnabled: boolean; // Controls whether the handler is active
    isCarMode?: boolean; // Whether car mode is active (affects A/D behavior)
    
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
    isEnabled,
    isCarMode = false,
    targetRef 
}) => {
    const isMouseDownRef = useRef(false);
    const dragDistanceRef = useRef(0);
    // Track if the current drag operation started on the target element
    const dragStartedOnTargetRef = useRef(false);

    // Refs to store the latest versions of callbacks to prevent useEffect thrashing
    const onPanRef = useRef(onPan);
    const onZoomRef = useRef(onZoom);
    const onMoveRef = useRef(onMove);
    const onRightClickMoveRef = useRef(onRightClickMove);
    const onToggleCarModeRef = useRef(onToggleCarMode);
    const onSteerRef = useRef(onSteer);
    const onRecenterHeadRef = useRef(onRecenterHead);
    const isCarModeRef = useRef(isCarMode);

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
        onRecenterHeadRef.current = onRecenterHead;
        isCarModeRef.current = isCarMode;
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
            if (e.button === 0) { // Left mouse button
                isMouseDownRef.current = false;
                
                // Only trigger click-to-move if drag started on target
                if (dragStartedOnTargetRef.current && dragDistanceRef.current < 5) {
                    onMoveRef.current('forward');
                }
                
                dragStartedOnTargetRef.current = false;
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            // Only process pan if a drag operation actually started on the target
            if (isMouseDownRef.current && dragStartedOnTargetRef.current) {
                const dist = Math.hypot(e.movementX, e.movementY);
                dragDistanceRef.current += dist;
                onPanRef.current(e.movementX, e.movementY);
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
                case 'c':
                    // Long press C for recenter, short press for toggle
                    if (isCarModeRef.current) {
                        onRecenterHeadRef.current?.();
                    } else {
                        onToggleCarModeRef.current?.();
                    }
                    break;
            }
            // A/D and Arrow keys are handled in the animation loop for continuous steering
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
            const isLeft = keys.has('a') || keys.has('arrowleft');
            const isRight = keys.has('d') || keys.has('arrowright');

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
            
            // Cancel steering loop
            cancelAnimationFrame(steerAnimationRef.current);
        };
    }, [isEnabled, targetRef]);

    return null; // This component does not render anything
};

export default InputHandler;
