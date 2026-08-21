import React from 'react';
import type { DeviceCapabilities, QualitySettings } from '../../hooks/useDeviceDetection';
import { type VehicleType, type VehicleConfig } from '../../car/VehicleManager';

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

function deviceTypeLabel(device: DeviceCapabilities): string {
  if (device.isMobile) return 'Mobile';
  if (device.isTablet) return 'Tablet';
  return 'Desktop';
}

interface MobileSettingsSheetProps {
  quality: QualitySettings;
  device: DeviceCapabilities;
  onClose: () => void;
  onToggleBatterySave: () => void;
  onResetQuality: () => void;
}

export const MobileSettingsSheet: React.FC<MobileSettingsSheetProps> = ({
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
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 style={{ margin: '0 0 20px', color: '#fff', fontSize: '20px' }}>Settings</h2>

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

      <div style={{ marginTop: '20px' }}>
        <h3 style={{ color: '#888', fontSize: '14px', margin: '0 0 12px' }}>Current Quality</h3>
        <QualityRow label="Render Scale" value={`${Math.round(quality.renderScale * 100)}%`} />
        <QualityRow label="Texture Quality" value={quality.textureQuality} />
        <QualityRow label="Target FPS" value={quality.frameRate.toString()} />
        <QualityRow label="Shadows" value={quality.shadowQuality} />
        <QualityRow label="Post Processing" value={quality.postProcessing ? 'On' : 'Off'} />
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3 style={{ color: '#888', fontSize: '14px', margin: '0 0 12px' }}>Device Info</h3>
        <QualityRow label="Type" value={deviceTypeLabel(device)} />
        <QualityRow label="Screen" value={`${device.screenSize.width}x${device.screenSize.height}`} />
        <QualityRow label="Touch" value={device.isTouchDevice ? 'Yes' : 'No'} />
      </div>

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

interface MobileVehicleSheetProps {
  vehicles: VehicleConfig[];
  currentVehicle: VehicleType;
  onSelect: (vehicle: VehicleType) => void;
  onClose: () => void;
}

export const MobileVehicleSheet: React.FC<MobileVehicleSheetProps> = ({
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
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
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
