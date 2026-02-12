import React, { useEffect, useRef } from 'react';

interface InputHandlerProps {
    // Callbacks to notify the parent component of user actions
    onPan: (deltaX: number, deltaY: number) => void;
    onZoom: (deltaZ: number) => void;
    onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
    onRightClickMove: () => void; // Specific callback for right-click forward movement

    // State from the parent to control behavior
    isEnabled: boolean; // Controls whether the handler is active
    
    // Target element for scoped mouse events
    targetRef: React.RefObject<HTMLElement | null>;
}

const InputHandler: React.FC<InputHandlerProps> = ({ 
    onPan, 
    onZoom, 
    onMove, 
    onRightClickMove, 
    isEnabled,
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

    // Keep refs up to date
    useEffect(() => {
        onPanRef.current = onPan;
        onZoomRef.current = onZoom;
        onMoveRef.current = onMove;
        onRightClickMoveRef.current = onRightClickMove;
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
            
            switch (e.key.toLowerCase()) {
                case 'w':
                    onMoveRef.current('forward');
                    break;
                case 's':
                    onMoveRef.current('backward');
                    break;
                case 'a':
                    onMoveRef.current('left');
                    break;
                case 'd':
                    onMoveRef.current('right');
                    break;
            }
        };

        // Attach scoped listeners to target element
        target.addEventListener('mousedown', handleMouseDown);
        target.addEventListener('wheel', handleWheel, { passive: false });
        target.addEventListener('contextmenu', handleContextMenu);
        
        // Attach global listeners to window
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('keydown', handleKeyDown);

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
        };
    }, [isEnabled, targetRef]);

    return null; // This component does not render anything
};

export default InputHandler;
