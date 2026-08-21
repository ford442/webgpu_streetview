import React from 'react';
import PlaceSearchBar from '../PlaceSearchBar';
import type { UsePlaceSearchResult } from '../../hooks/usePlaceSearch';

interface ActionButtonProps {
  onClick: () => void;
  active?: boolean;
  size: number;
  icon: string;
  label: string;
}

export const MobileActionButton: React.FC<ActionButtonProps> = ({
  onClick,
  active,
  size,
  icon,
  label,
}) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
      background: 'transparent',
      border: 'none',
      color: active ? '#4CAF50' : '#fff',
      cursor: 'pointer',
      padding: '4px',
    }}
  >
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: active ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.15)',
        border: `2px solid ${active ? '#4CAF50' : 'rgba(255,255,255,0.3)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
      }}
    >
      {icon}
    </div>
    <span style={{ fontSize: '11px', fontWeight: 500 }}>{label}</span>
  </button>
);

export const MobileCompassIcon: React.FC<{ heading: number; size: number }> = ({ heading, size }) => (
  <div
    style={{
      width: size,
      height: size,
      transform: `rotate(${-heading}deg)`,
      transition: 'transform 0.1s ease-out',
    }}
  >
    <svg viewBox="0 0 24 24" fill="white" width={size} height={size}>
      <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
    </svg>
  </div>
);

export const moveButtonStyle = (size: number, col: number, row: number): React.CSSProperties => ({
  width: size,
  height: size,
  gridColumn: col,
  gridRow: row,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.2)',
  border: '2px solid rgba(255,255,255,0.4)',
  color: '#fff',
  fontSize: size * 0.35,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
});

interface MobileTopBarProps {
  isSmallScreen: boolean;
  buttonSize: number;
  iconSize: number;
  heading: number;
  zoom: number;
  search?: UsePlaceSearchResult;
  onOpenSettings: () => void;
}

export const MobileTopBar: React.FC<MobileTopBarProps> = ({
  isSmallScreen,
  buttonSize,
  iconSize,
  heading,
  zoom,
  search,
  onOpenSettings,
}) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      padding: isSmallScreen ? '8px 12px' : '12px 16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
      zIndex: 10,
      pointerEvents: 'none',
    }}
  >
    <div
      style={{
        width: buttonSize,
        height: buttonSize,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
        border: '2px solid rgba(255,255,255,0.3)',
      }}
    >
      <MobileCompassIcon heading={heading} size={iconSize} />
    </div>

    <div style={{ pointerEvents: 'auto', flex: 1, display: 'flex', justifyContent: 'center', padding: '0 8px' }}>
      {search ? (
        <PlaceSearchBar search={search} compact />
      ) : (
        <div
          style={{
            padding: '6px 12px',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '16px',
            color: '#fff',
            fontSize: isSmallScreen ? '12px' : '14px',
            fontWeight: '500',
          }}
        >
          {zoom.toFixed(1)}x
        </div>
      )}
    </div>

    <button
      onClick={onOpenSettings}
      style={{
        width: buttonSize,
        height: buttonSize,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.5)',
        border: '2px solid rgba(255,255,255,0.3)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
        cursor: 'pointer',
        fontSize: iconSize,
      }}
    >
      ⚙️
    </button>
  </div>
);

interface MobileMovePadProps {
  buttonSize: number;
  onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
}

export const MobileMovePad: React.FC<MobileMovePadProps> = ({ buttonSize, onMove }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      gap: '20px',
      alignItems: 'center',
    }}
  >
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${buttonSize}px ${buttonSize}px ${buttonSize}px`,
        gridTemplateRows: `${buttonSize}px ${buttonSize}px`,
        gap: '4px',
      }}
    >
      <button onClick={() => onMove('forward')} style={moveButtonStyle(buttonSize, 2, 1)}>▲</button>
      <button onClick={() => onMove('left')} style={moveButtonStyle(buttonSize, 1, 2)}>◀</button>
      <button onClick={() => onMove('backward')} style={moveButtonStyle(buttonSize, 2, 2)}>▼</button>
      <button onClick={() => onMove('right')} style={moveButtonStyle(buttonSize, 3, 2)}>▶</button>
    </div>
  </div>
);
