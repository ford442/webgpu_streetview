import React from 'react';
import type { UseTouchControlsReturn } from '../../hooks/useTouchControls';

interface MobileTouchLayerProps {
  bindTouchEvents: UseTouchControlsReturn['bindTouchEvents'];
  isMapOpen: boolean;
  isDragging: boolean;
  isPinching: boolean;
}

/** Full-viewport gesture overlay + pinch/drag indicator. */
export const MobileTouchLayer: React.FC<MobileTouchLayerProps> = ({
  bindTouchEvents,
  isMapOpen,
  isDragging,
  isPinching,
}) => (
  <>
    <div
      {...bindTouchEvents}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
        touchAction: 'none',
        pointerEvents: isMapOpen ? 'none' : 'auto',
      }}
    />
    {(isDragging || isPinching) && (
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          padding: '16px 24px',
          background: 'rgba(0,0,0,0.7)',
          borderRadius: '12px',
          color: '#fff',
          fontSize: '14px',
          pointerEvents: 'none',
          zIndex: 15,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {isDragging ? '👆 Drag to look' : '👌 Pinch to zoom'}
      </div>
    )}
  </>
);
