import React, { useState, useCallback, useEffect } from 'react';
import { useTouchControls } from '../hooks/useTouchControls';
import { useDeviceDetection, type QualitySettings } from '../hooks/useDeviceDetection';
import { type VehicleType, VehicleConfig, VEHICLES } from '../car/VehicleManager';
import type { MobileChromeContract } from '../app/shell/chromePanelContracts';

export type MobileUIProps = MobileChromeContract;

/**
 * Mobile-optimized UI for the Street View viewer
 * Provides touch-friendly controls and responsive layout
 */
export const MobileUI: React.FC<MobileUIProps> = ({
  isVisible,
  onPan,
  onZoom,
  onMove,
  onToggleCarMode,
  onToggleMap,
  onTakeSnapshot,
  onToggleWipers,
  onToggleRoof,
  onVehicleChange,
  onQualityChange,
  currentVehicle = 'sedan',
  isCarMode = false,
  isMapOpen = false,
  wipersEnabled = false,
  isRoofOpen = false,
  heading = 0,
  zoom = 1,
}) => {
  const { device, quality, setBatterySaveMode, resetToOptimal } = useDeviceDetection();
  const [showSettings, setShowSettings] = useState(false);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Touch controls for the main viewport
  const { bindTouchEvents, gestureState } = useTouchControls({
    enabled: isVisible && !isMapOpen,
    onPan,
    onZoom,
    onDoubleTap: onTakeSnapshot,
    panSensitivity: 0.4,
    zoomSensitivity: 0.8,
  });

  // Notify parent of quality changes
  useEffect(() => {
    onQualityChange?.(quality);
  }, [quality, onQualityChange]);

  // Handle move button press with repeat
  const handleMovePress = useCallback((direction: 'forward' | 'backward' | 'left' | 'right') => {
    onMove(direction);
  }, [onMove]);

  if (!isVisible) return null;

  // Calculate responsive sizes based on screen dimensions
  const isSmallScreen = device.screenSize.width < 360;
  const buttonSize = isSmallScreen ? 44 : 56;
  const iconSize = isSmallScreen ? 20 : 24;

  return (
    <>
      {/* Touch Area Overlay - captures gestures for the main view */}
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

      {/* Top Bar - Status and Quick Actions */}
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
        {/* Left: Compass */}
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
          <CompassIcon heading={heading} size={iconSize} />
        </div>

        {/* Center: Zoom indicator */}
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

        {/* Right: Settings button */}
        <button
          onClick={() => setShowSettings(true)}
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

      {/* Gesture Indicator - shows during touch interactions */}
      {(gestureState.isDragging || gestureState.isPinching) && (
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
          {gestureState.isDragging ? '👆 Drag to look' : '👌 Pinch to zoom'}
        </div>
      )}

      {/* Bottom Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: isSmallScreen ? '12px' : '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
          zIndex: 10,
        }}
      >
        {/* Movement Controls - D-Pad style */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '20px',
            alignItems: 'center',
          }}
        >
          {/* D-Pad */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `${buttonSize}px ${buttonSize}px ${buttonSize}px`,
              gridTemplateRows: `${buttonSize}px ${buttonSize}px`,
              gap: '4px',
            }}
          >
            <button
              onClick={() => handleMovePress('forward')}
              style={moveButtonStyle(buttonSize, 2, 1)}
            >
              ▲
            </button>
            <button
              onClick={() => handleMovePress('left')}
              style={moveButtonStyle(buttonSize, 1, 2)}
            >
              ◀
            </button>
            <button
              onClick={() => handleMovePress('backward')}
              style={moveButtonStyle(buttonSize, 2, 2)}
            >
              ▼
            </button>
            <button
              onClick={() => handleMovePress('right')}
              style={moveButtonStyle(buttonSize, 3, 2)}
            >
              ▶
            </button>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '8px 0',
          }}
        >
          {/* Map Toggle */}
          <ActionButton
            onClick={onToggleMap}
            active={isMapOpen}
            size={buttonSize}
            icon="🗺️"
            label="Map"
          />

          {/* Car Mode Toggle */}
          <ActionButton
            onClick={onToggleCarMode}
            active={isCarMode}
            size={buttonSize}
            icon="🚗"
            label="Car"
          />

          {/* Snapshot */}
          <ActionButton
            onClick={onTakeSnapshot}
            size={buttonSize}
            icon="📸"
            label="Photo"
          />

          {/* Vehicle Selector */}
          {isCarMode && (
            <ActionButton
              onClick={() => setShowVehicleSelector(true)}
              size={buttonSize}
              icon="🔄"
              label="Vehicle"
            />
          )}

          {/* Wipers Toggle */}
          {isCarMode && onToggleWipers && (
            <ActionButton
              onClick={onToggleWipers}
              active={wipersEnabled}
              size={buttonSize}
              icon="💧"
              label="Wipers"
            />
          )}

          {/* Roof Toggle */}
          {isCarMode && onToggleRoof && (
            <ActionButton
              onClick={onToggleRoof}
              active={isRoofOpen}
              size={buttonSize}
              icon="☀️"
              label="Roof"
            />
          )}
        </div>

        {/* Battery Save Indicator */}
        {quality.batterySaveMode && (
          <div
            style={{
              textAlign: 'center',
              padding: '6px',
              background: 'rgba(255,193,7,0.2)',
              borderRadius: '8px',
              color: '#ffc107',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            🔋 Battery Save Mode
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          quality={quality}
          device={device}
          onClose={() => setShowSettings(false)}
          onToggleBatterySave={() => setBatterySaveMode(!quality.batterySaveMode)}
          onResetQuality={resetToOptimal}
        />
      )}

      {/* Vehicle Selector Modal */}
      {showVehicleSelector && (
        <VehicleSelectorModal
          vehicles={Object.values(VEHICLES)}
          currentVehicle={currentVehicle}
          onSelect={(v) => {
            onVehicleChange?.(v);
            setShowVehicleSelector(false);
          }}
          onClose={() => setShowVehicleSelector(false)}
        />
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal onClose={() => setShowHelp(false)} />
      )}
    </>
  );
};

// Helper Components

interface ActionButtonProps {
  onClick: () => void;
  active?: boolean;
  size: number;
  icon: string;
  label: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, active, size, icon, label }) => (
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

interface CompassIconProps {
  heading: number;
  size: number;
}

const CompassIcon: React.FC<CompassIconProps> = ({ heading, size }) => (
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

// Move button style helper
const moveButtonStyle = (size: number, col: number, row: number): React.CSSProperties => ({
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
} as React.CSSProperties);

// Settings Modal
interface SettingsModalProps {
  quality: QualitySettings;
  device: any;
  onClose: () => void;
  onToggleBatterySave: () => void;
  onResetQuality: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  quality,
  device,
  onClose,
  onToggleBatterySave,
  onResetQuality,
}) => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}
    onClick={onClose}
  >
    <div
      style={{
        background: '#1a1a1a',
        borderRadius: '16px',
        padding: '24px',
        width: '100%',
        maxWidth: '360px',
        maxHeight: '80vh',
        overflow: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 style={{ margin: '0 0 20px', color: '#fff', fontSize: '20px' }}>Settings</h2>

      {/* Battery Save Mode */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 0',
          borderBottom: '1px solid #333',
        }}
      >
        <div>
          <div style={{ color: '#fff', fontSize: '16px' }}>🔋 Battery Save Mode</div>
          <div style={{ color: '#888', fontSize: '12px' }}>Reduce quality for longer sessions</div>
        </div>
        <Toggle checked={quality.batterySaveMode} onChange={onToggleBatterySave} />
      </div>

      {/* Quality Info */}
      <div style={{ marginTop: '20px' }}>
        <h3 style={{ color: '#888', fontSize: '14px', margin: '0 0 12px' }}>Current Quality</h3>
        <QualityRow label="Render Scale" value={`${Math.round(quality.renderScale * 100)}%`} />
        <QualityRow label="Texture Quality" value={quality.textureQuality} />
        <QualityRow label="Target FPS" value={quality.frameRate.toString()} />
        <QualityRow label="Shadows" value={quality.shadowQuality} />
        <QualityRow label="Post Processing" value={quality.postProcessing ? 'On' : 'Off'} />
      </div>

      {/* Device Info */}
      <div style={{ marginTop: '20px' }}>
        <h3 style={{ color: '#888', fontSize: '14px', margin: '0 0 12px' }}>Device Info</h3>
        <QualityRow label="Type" value={device.isMobile ? 'Mobile' : device.isTablet ? 'Tablet' : 'Desktop'} />
        <QualityRow label="Screen" value={`${device.screenSize.width}x${device.screenSize.height}`} />
        <QualityRow label="Touch" value={device.isTouchDevice ? 'Yes' : 'No'} />
      </div>

      {/* Actions */}
      <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
        <button
          onClick={onResetQuality}
          style={{
            flex: 1,
            padding: '12px',
            background: '#333',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Reset Quality
        </button>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '12px',
            background: '#2196F3',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </div>
  </div>
);

const QualityRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      color: '#ccc',
      fontSize: '14px',
    }}
  >
    <span>{label}</span>
    <span style={{ color: '#fff', fontWeight: 500 }}>{value}</span>
  </div>
);

const Toggle: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <button
    onClick={onChange}
    style={{
      width: '50px',
      height: '28px',
      borderRadius: '14px',
      background: checked ? '#4CAF50' : '#666',
      border: 'none',
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 0.2s',
    }}
  >
    <div
      style={{
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: '#fff',
        position: 'absolute',
        top: '3px',
        left: checked ? '25px' : '3px',
        transition: 'left 0.2s',
      }}
    />
  </button>
);

// Vehicle Selector Modal
interface VehicleSelectorModalProps {
  vehicles: VehicleConfig[];
  currentVehicle: VehicleType;
  onSelect: (vehicle: VehicleType) => void;
  onClose: () => void;
}

const VehicleSelectorModal: React.FC<VehicleSelectorModalProps> = ({
  vehicles,
  currentVehicle,
  onSelect,
  onClose,
}) => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}
    onClick={onClose}
  >
    <div
      style={{
        background: '#1a1a1a',
        borderRadius: '16px',
        padding: '24px',
        width: '100%',
        maxWidth: '360px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 style={{ margin: '0 0 20px', color: '#fff', fontSize: '20px' }}>Select Vehicle</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {vehicles.map((vehicle) => (
          <button
            key={vehicle.type}
            onClick={() => onSelect(vehicle.type)}
            style={{
              padding: '16px',
              background: vehicle.type === currentVehicle ? 'rgba(76,175,80,0.2)' : '#333',
              border: `2px solid ${vehicle.type === currentVehicle ? '#4CAF50' : 'transparent'}`,
              borderRadius: '12px',
              color: '#fff',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {vehicle.name}
            {vehicle.type === currentVehicle && <span>✓</span>}
          </button>
        ))}
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%',
          marginTop: '16px',
          padding: '12px',
          background: '#666',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  </div>
);

// Help Modal
const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}
    onClick={onClose}
  >
    <div
      style={{
        background: '#1a1a1a',
        borderRadius: '16px',
        padding: '24px',
        width: '100%',
        maxWidth: '360px',
        maxHeight: '80vh',
        overflow: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 style={{ margin: '0 0 20px', color: '#fff', fontSize: '20px' }}>How to Use</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <HelpItem icon="👆" text="Drag to look around" />
        <HelpItem icon="👌" text="Pinch to zoom in/out" />
        <HelpItem icon="👆👆" text="Double tap to take a photo" />
        <HelpItem icon="▲▼◀▶" text="Use D-pad to move" />
        <HelpItem icon="🚗" text="Tap Car for interior view" />
        <HelpItem icon="🗺️" text="Tap Map to see your location" />
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%',
          marginTop: '24px',
          padding: '12px',
          background: '#2196F3',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        Got it!
      </button>
    </div>
  </div>
);

const HelpItem: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#ccc' }}>
    <span style={{ fontSize: '24px', width: '40px', textAlign: 'center' }}>{icon}</span>
    <span style={{ fontSize: '14px' }}>{text}</span>
  </div>
);

export default MobileUI;
