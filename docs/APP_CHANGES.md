// Key changes to App.tsx for proper free look / car steering separation

// 1. Add new state for head coupling mode
const [headCoupling, setHeadCoupling] = useState<'rigid' | 'free'>('rigid');

// 2. Modify handleSteer to support both modes
const handleSteer = useCallback((direction: 'left' | 'right', deltaTime: number) => {
    if (!isCarMode) return;
    const turnRate = KEYBOARD_STEER_RATE * deltaTime;
    
    if (direction === 'left') {
        setCarHeading(prev => (prev - turnRate + 360) % 360);
        steeringInputRef.current = Math.max(-90, steeringInputRef.current - turnRate * 0.5);
        
        // In free coupling mode, compensate head to stay looking same world direction
        if (headCoupling === 'free') {
            setHeadYawOffset(prev => prev + turnRate); // Compensate for car turn
        }
    } else {
        setCarHeading(prev => (prev + turnRate) % 360);
        steeringInputRef.current = Math.min(90, steeringInputRef.current + turnRate * 0.5);
        
        // In free coupling mode, compensate head to stay looking same world direction
        if (headCoupling === 'free') {
            setHeadYawOffset(prev => prev - turnRate); // Compensate for car turn
        }
    }
    
    setCarSteering(steeringInputRef.current);
}, [isCarMode, headCoupling]);

// 3. Add toggle function
const handleToggleHeadCoupling = useCallback(() => {
    if (!isCarMode) return;
    setHeadCoupling(prev => {
        const next = prev === 'rigid' ? 'free' : 'rigid';
        console.log(`Head coupling: ${next}`);
        return next;
    });
}, [isCarMode]);

// 4. Clamp headYawOffset to prevent gimbal lock
const MAX_HEAD_YAW = 110;
const MAX_HEAD_PITCH_UP = 45;
const MAX_HEAD_PITCH_DOWN = 65;

// Update handlePan to respect limits
const handlePan = useCallback((deltaX: number, deltaY: number) => {
    if (isCarMode) {
        setHeadYawOffset(prev => Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, prev + deltaX * HEAD_LOOK_SENSITIVITY)));
        setHeadPitch(prev => Math.max(-MAX_HEAD_PITCH_UP, Math.min(MAX_HEAD_PITCH_DOWN, prev - deltaY * HEAD_LOOK_SENSITIVITY)));
    } else {
        setHeading(prev => (prev + deltaX * 0.1) % 360);
        setPitch(prev => Math.max(-90, Math.min(90, prev - deltaY * 0.1)));
    }
}, [isCarMode]);

// 5. Add UI indicator for head coupling mode
{
    isCarMode && (
        <div style={{ 
            position: 'absolute', 
            top: 10, 
            left: 10, 
            background: 'rgba(0,0,0,0.7)',
            padding: '8px',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '12px',
            zIndex: 100
        }}>
            <div>Mode: {headCoupling === 'rigid' ? '🚗 Rigid' : '👀 Free Look'}</div>
            <div style={{ fontSize: '10px', opacity: 0.7 }}>
                {headCoupling === 'rigid' 
                    ? 'Head turns with car (A/D steers)' 
                    : 'Head stays fixed (A/D steers car only)'}
            </div>
            <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '4px' }}>
                Press [H] to toggle | Middle mouse = Free look
            </div>
        </div>
    )
}

// 6. Update InputHandler props
<InputHandler
    isEnabled={isConnected && !showWelcome}
    targetRef={canvasContainerRef}
    onPan={handlePan}
    onZoom={handleZoom}
    onMove={handleMove}
    onRightClickMove={handleRightClickMove}
    onToggleCarMode={handleToggleCarMode}
    onSteer={handleSteer}
    onRecenterHead={handleRecenterHead}
    onMouseSteer={handleMouseSteer}
    onToggleHeadCoupling={handleToggleHeadCoupling} // NEW
    isCarMode={isCarMode}
    headCoupling={headCoupling} // NEW
    isSteeringWheelAtPoint={isCarMode ? isCarSteeringWheelHit : undefined}
/>
