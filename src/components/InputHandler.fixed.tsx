import React, { useEffect, useRef } from 'react';

interface InputHandlerProps {
    onPan: (deltaX: number, deltaY: number) => void;
    onZoom: (deltaZ: number) => void;
    onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
    onRightClickMove: () => void;
    onToggleCarMode?: () => void;
    onSteer?: (direction: 'left' | 'right', deltaTime: number) => void;
    onRecenterHead?: () => void;
    onMouseSteer?: (deltaX: number) => void;
    onToggleHeadCoupling?: () => void; // NEW: Toggle between rigid/free head
    isSteeringWheelAtPoint?: (x: number, y: number) => boolean;

    isEnabled: boolean;
    isCarMode?: boolean;
    headCoupling?: 'rigid' | 'free'; // NEW: Current head coupling mode
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
    onToggleHeadCoupling, // NEW
    isSteeringWheelAtPoint,
    isEnabled,
    isCarMode = false,
    headCoupling = 'rigid', // NEW: Default to rigid (head turns with car)
    targetRef 
}) => {
    const isMouseDownRef = useRef(false);
    const dragDistanceRef = useRef(0);
    const CLICK_DRAG_THRESHOLD = 5;
    const dragStartedOnTargetRef = useRef(false);
    const isShiftDragRef = useRef(false);
    const isSteeringWheelDragRef = useRef(false);
    const isMiddleMouseRef = useRef(false); // NEW: Track middle mouse for free look

    const onPanRef = useRef(onPan);
    const onZoomRef = useRef(onZoom);
    const onMoveRef = useRef(onMove);
    const onRightClickMoveRef = useRef(onRightClickMove);
    const onToggleCarModeRef = useRef(onToggleCarMode);
    const onSteerRef = useRef(onSteer);
    const onRecenterHeadRef = useRef(onRecenterHead);
    const onMouseSteerRef = useRef(onMouseSteer);
    const onToggleHeadCouplingRef = useRef(onToggleHeadCoupling); // NEW
    const isCarModeRef = useRef(isCarMode);
    const headCouplingRef = useRef(headCoupling); // NEW
    const isSteeringWheelAtPointRef = useRef(isSteeringWheelAtPoint);

    const keysPressedRef = useRef<Set<string>>(new Set());
    const lastTimeRef = useRef<number>(0);
    const steerAnimationRef = useRef<number>(0);
    const lastHitTestTimeRef = useRef<number>(0);

    useEffect(() => {
        onPanRef.current = onPan;
        onZoomRef.current = onZoom;
        onMoveRef.current = onMove;
        onRightClickMoveRef.current = onRightClickMove;
        onToggleCarModeRef.current = onToggleCarMode;
        onSteerRef.current = onSteer;
        onRecenterHeadRef.current = onRecenterHead;
        onMouseSteerRef.current = onMouseSteer;
        onToggleHeadCouplingRef.current = onToggleHeadCoupling; // NEW
        isCarModeRef.current = isCarMode;
        headCouplingRef.current = headCoupling; // NEW
        isSteeringWheelAtPointRef.current = isSteeringWheelAtPoint;
    });

    useEffect(() => {
        if (!isEnabled) return;
        
        const target = targetRef.current;
        if (!target) return;

        const handleMouseDown = (e: MouseEvent) => {
            if (e.button === 0) { // Left click - normal interaction
                isMouseDownRef.current = true;
                dragStartedOnTargetRef.current = true;
                dragDistanceRef.current = 0;
                isShiftDragRef.current = e.shiftKey;
                isSteeringWheelDragRef.current = isCarModeRef.current
                    && !!isSteeringWheelAtPointRef.current?.(e.clientX, e.clientY);
                isMiddleMouseRef.current = false;
            } else if (e.button === 1) { // Middle mouse - FREE LOOK only
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

        const handleMouseUp = (e: MouseEvent) => {
            if (e.button === 0 || e.button === 1) {
                const wasSteeringWheelDrag = isSteeringWheelDragRef.current;
                const wasShiftDrag = isShiftDragRef.current;
                const wasMiddleMouse = isMiddleMouseRef.current;

                isMouseDownRef.current = false;
                isSteeringWheelDragRef.current = false;
                isShiftDragRef.current = false;
                isMiddleMouseRef.current = false;
                
                if (target) (target as HTMLElement).style.cursor = '';
                
                // Only trigger click-to-move on left click (not middle)
                if (dragStartedOnTargetRef.current 
                    && dragDistanceRef.current < CLICK_DRAG_THRESHOLD
                    && !wasSteeringWheelDrag 
                    && !wasShiftDrag 
                    && !wasMiddleMouse) {
                    onMoveRef.current('forward');
                }
                
                dragStartedOnTargetRef.current = false;
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            // Update cursor for steering wheel hit test
            if (!isMouseDownRef.current && target 
                && isCarModeRef.current 
                && isSteeringWheelAtPointRef.current) {
                const now = performance.now();
                if (now - lastHitTestTimeRef.current > 50) {
                    lastHitTestTimeRef.current = now;
                    const onWheel = isSteeringWheelAtPointRef.current(e.clientX, e.clientY);
                    (target as HTMLElement).style.cursor = onWheel ? 'grab' : '';
                }
            }

            if (isMouseDownRef.current && dragStartedOnTargetRef.current) {
                const dist = Math.hypot(e.movementX, e.movementY);
                dragDistanceRef.current += dist;

                // MIDDLE MOUSE = Free look only (NEW)
                if (isMiddleMouseRef.current) {
                    onPanRef.current(e.movementX, e.movementY);
                }
                // Steering wheel drag = car steering
                else if (isSteeringWheelDragRef.current && onMouseSteerRef.current) {
                    onMouseSteerRef.current(e.movementX);
                }
                // Shift+drag = car steering (with head look if free coupling)
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

        const handleKeyDown = (e: KeyboardEvent) => {
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
                    e.preventDefault();
                    onMoveRef.current('forward');
                    break;
                case 'arrowdown':
                    e.preventDefault();
                    onMoveRef.current('backward');
                    break;
                case 'arrowleft':
                    e.preventDefault();
                    onMoveRef.current('left');
                    break;
                case 'arrowright':
                    e.preventDefault();
                    onMoveRef.current('right');
                    break;
                case 'c':
                    if (isCarModeRef.current) {
                        onRecenterHeadRef.current?.();
                    } else {
                        onToggleCarModeRef.current?.();
                    }
                    break;
                case 'h': // NEW: Toggle head coupling mode
                    if (isCarModeRef.current) {
                        onToggleHeadCouplingRef.current?.();
                    }
                    break;
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressedRef.current.delete(e.key.toLowerCase());
            keysPressedRef.current.delete(e.key);
        };

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

        steerAnimationRef.current = requestAnimationFrame(steerLoop);

        target.addEventListener('mousedown', handleMouseDown);
        target.addEventListener('wheel', handleWheel, { passive: false });
        target.addEventListener('contextmenu', handleContextMenu);
        
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            target.removeEventListener('mousedown', handleMouseDown);
            target.removeEventListener('wheel', handleWheel);
            target.removeEventListener('contextmenu', handleContextMenu);
            
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            
            (target as HTMLElement).style.cursor = '';
            
            cancelAnimationFrame(steerAnimationRef.current);
        };
    }, [isEnabled, targetRef]);

    return null;
};

export default InputHandler;
