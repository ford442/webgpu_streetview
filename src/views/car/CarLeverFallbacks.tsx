import React from 'react';
import type { GearPosition, WiperStalkPosition } from '../../car';
import type { CarHudMode } from './useCarHudMode';

export interface CarLeverFallbacksProps {
  hudMode: CarHudMode;
  gear: GearPosition;
  gearPositions: readonly GearPosition[];
  wiperStalk: WiperStalkPosition;
  onSelectGear: (gear: GearPosition) => void;
  onCycleWipers: () => void;
}

export const CarLeverFallbacks: React.FC<CarLeverFallbacksProps> = ({
  hudMode,
  gear,
  gearPositions,
  wiperStalk,
  onSelectGear,
  onCycleWipers,
}) => {
  if (hudMode === 'immersive') return null;

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px',
        background: 'rgba(15, 20, 25, 0.8)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        color: '#fff',
        fontFamily: "'SF Pro Display', system-ui, sans-serif",
        fontSize: '10px',
        zIndex: 101,
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ opacity: 0.7 }}>Gear</div>
      <div role="group" aria-label="Gear selector" style={{ display: 'flex', gap: '3px' }}>
        {gearPositions.map((option) => (
          <button
            key={option}
            onClick={() => onSelectGear(option)}
            aria-pressed={gear === option}
            aria-label={`Select gear ${option}`}
            style={{
              width: '22px',
              padding: '4px 0',
              background: gear === option ? 'rgba(0,212,255,0.25)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: gear === option ? '#00d4ff' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <button
        onClick={onCycleWipers}
        aria-label={`Wiper stalk: ${wiperStalk}. Activate to cycle.`}
        title="Wiper stalk — Off / Int / Low / High"
        style={{
          padding: '4px 8px',
          background: wiperStalk === 'off' ? 'rgba(255,255,255,0.05)' : 'rgba(0,212,255,0.2)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '6px',
          color: wiperStalk === 'off' ? 'rgba(255,255,255,0.6)' : '#00d4ff',
          cursor: 'pointer',
          fontSize: '10px',
          textTransform: 'capitalize',
        }}
      >
        {`Wipers: ${wiperStalk}`}
      </button>
    </div>
  );
};
