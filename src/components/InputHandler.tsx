import React, { useEffect, useRef } from 'react';

interface InputHandlerProps {
    // Callbacks to notify the parent component of user actions
    onPan: (deltaX: number, deltaY: number) => void;
    onZoom: (deltaZ: number) => void;
    onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
    onRightClickMove: () => void; // Specific callback for right-click forward movement

    // State from the parent to control behavior
    isEnabled: boolean; // Controls whether the handler is active
}

const InputHandler: React.FC<InputHandlerProps> = ({ onPan, onZoom, onMove, onRightClickMove, isEnabled }) => {
    const isMouseDownRef = useRef(false);

    useEffect(() => {
        if (!isEnabled) return;

        const handleMouseDown = (e: MouseEvent) => {
            if (e.button === 0) { // Left mouse button
                isMouseDownRef.current = true;
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (e.button === 0) { // Left mouse button
                isMouseDownRef.current = false;
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (isMouseDownRef.current) {
                onPan(e.movementX, e.movementY);
            }
        };

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            onZoom(e.deltaY);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key.toLowerCase()) {
                case 'w':
                    onMove('forward');
                    break;
                case 's':
                    onMove('backward');
                    break;
                case 'a':
                    onMove('left');
                    break;
                case 'd':
                    onMove('right');
                    break;
            }
        };

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            onRightClickMove();
        };

        // Attach event listeners
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('contextmenu', handleContextMenu);

        // Cleanup
        return () => {
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('contextmenu', handleContextMenu);
        };
    }, [isEnabled, onPan, onZoom, onMove, onRightClickMove]);

    return null; // This component does not render anything
};

export default InputHandler;
