import React from 'react';
import type { ControlMode } from '../../hooks/useViewMode';
import { getModeDescription, getModeDisplayName } from './carModeUtils';
import type { CarHudMode } from './useCarHudMode';

export interface CarControlModeOverlayProps {
  controlMode: ControlMode;
  hudMode: CarHudMode;
  /** Runs inside the click handler — Steer/Free Look request pointer lock. */
  selectControlMode: (mode: ControlMode) => void;
  setHudModeAndPersist: (mode: CarHudMode) => void;
  toggleDashboard: () => void;
}

export const CarControlModeOverlay: React.FC<CarControlModeOverlayProps> = ({
  controlMode,
  hudMode,
  selectControlMode,
  setHudModeAndPersist,
  toggleDashboard,
}) => (
  <div
    onMouseDown={(e) => e.stopPropagation()}
    onMouseUp={(e) => e.stopPropagation()}
    onMouseMove={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()}
    style={{
      position: 'absolute',
      top: 10,
      left: 10,
      background: 'rgba(15, 20, 25, 0.8)',
      backdropFilter: 'blur(8px)',
      borderRadius: '12px',
      color: '#fff',
      fontSize: '12px',
      zIndex: 101,
      fontFamily: "'SF Pro Display', system-ui, sans-serif",
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      userSelect: 'none',
      padding: '8px 12px',
      pointerEvents: 'auto',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: controlMode === 'FREE_LOOK' ? '#4CAF50' : controlMode === 'UI_INTERACT' ? '#2196F3' : '#FF9800',
        boxShadow: `0 0 8px ${controlMode === 'FREE_LOOK' ? '#4CAF50' : controlMode === 'UI_INTERACT' ? '#2196F3' : '#FF9800'}`,
      }} />
      <span style={{ fontWeight: 600 }}>{getModeDisplayName(controlMode)}</span>
    </div>
    <div style={{ fontSize: '10px', opacity: 0.7, lineHeight: '1.3' }}>
      {getModeDescription(controlMode)}
    </div>
    <div style={{
      display: 'flex',
      gap: '4px',
      marginTop: '8px',
      paddingTop: '8px',
      borderTop: '1px solid rgba(255,255,255,0.1)',
    }}>
      {(['FREE_LOOK', 'UI_INTERACT', 'STEER'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => selectControlMode(mode)}
          style={{
            flex: 1,
            padding: '4px 8px',
            background: controlMode === mode
              ? (mode === 'FREE_LOOK' ? 'rgba(76,175,80,0.3)' : mode === 'UI_INTERACT' ? 'rgba(33,150,243,0.3)' : 'rgba(255,152,0,0.3)')
              : 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            color: controlMode === mode
              ? (mode === 'FREE_LOOK' ? '#A5D6A7' : mode === 'UI_INTERACT' ? '#90CAF9' : '#FFCC80')
              : 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontSize: '10px',
            transition: 'all 0.2s',
          }}
        >
          {mode === 'FREE_LOOK' ? 'Free' : mode === 'UI_INTERACT' ? 'UI' : 'Steer'}
        </button>
      ))}
    </div>
    <button
      onClick={hudMode === 'immersive' ? () => setHudModeAndPersist('compact') : toggleDashboard}
      title="Toggle dashboard HUD (U), hold U for immersive mode"
      style={{
        width: '100%',
        marginTop: '4px',
        padding: '4px 8px',
        background: hudMode === 'full' ? 'rgba(255,255,255,0.05)' : 'rgba(0,212,255,0.2)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '6px',
        color: hudMode === 'full' ? 'rgba(255,255,255,0.6)' : '#00d4ff',
        cursor: 'pointer',
        fontSize: '10px',
        transition: 'all 0.2s',
      }}
    >
      {hudMode === 'immersive' ? 'Exit Immersive' : hudMode === 'full' ? 'Compact HUD (U)' : 'Full HUD (U)'}
    </button>
  </div>
);
