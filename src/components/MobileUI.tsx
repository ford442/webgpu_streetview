import React, { useState, useCallback, useEffect } from 'react';
import { useTouchControls } from '../hooks/useTouchControls';
import { useDeviceDetection } from '../hooks/useDeviceDetection';
import { VEHICLES } from '../car/VehicleManager';
import type { MobileChromeContract } from '../app/shell/chromePanelContracts';
import { MobileTouchLayer } from './mobile/MobileTouchLayer';
import { MobileSettingsSheet, MobileVehicleSheet } from './mobile/MobileSettingsSheet';
import { MobileHelpSheet } from './mobile/MobileHelpSheet';
import { MobileActionButton, MobileMovePad, MobileTopBar } from './mobile/MobileChrome';

export type MobileUIProps = MobileChromeContract;

/**
 * Mobile-optimized UI for the Street View viewer.
 * Composes touch layer + chrome + settings/vehicle/help sheets.
 * `MobileChromeContract` is the only prop bag.
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
  search,
}) => {
  const { device, quality, setBatterySaveMode, resetToOptimal } = useDeviceDetection();
  const [showSettings, setShowSettings] = useState(false);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const { bindTouchEvents, gestureState } = useTouchControls({
    enabled: isVisible && !isMapOpen,
    onPan,
    onZoom,
    onDoubleTap: onTakeSnapshot,
    panSensitivity: 0.4,
    zoomSensitivity: 0.8,
  });

  useEffect(() => {
    onQualityChange?.(quality);
  }, [quality, onQualityChange]);

  const handleMovePress = useCallback((direction: 'forward' | 'backward' | 'left' | 'right') => {
    onMove(direction);
  }, [onMove]);

  if (!isVisible) return null;

  const isSmallScreen = device.screenSize.width < 360;
  const buttonSize = isSmallScreen ? 44 : 56;
  const iconSize = isSmallScreen ? 20 : 24;

  return (
    <>
      <MobileTouchLayer
        bindTouchEvents={bindTouchEvents}
        isMapOpen={isMapOpen}
        isDragging={gestureState.isDragging}
        isPinching={gestureState.isPinching}
      />

      <MobileTopBar
        isSmallScreen={isSmallScreen}
        buttonSize={buttonSize}
        iconSize={iconSize}
        heading={heading}
        zoom={zoom}
        search={search}
        onOpenSettings={() => setShowSettings(true)}
      />

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
        <MobileMovePad buttonSize={buttonSize} onMove={handleMovePress} />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '8px 0',
          }}
        >
          <MobileActionButton onClick={onToggleMap} active={isMapOpen} size={buttonSize} icon="🗺️" label="Map" />
          <MobileActionButton onClick={onToggleCarMode} active={isCarMode} size={buttonSize} icon="🚗" label="Car" />
          <MobileActionButton onClick={onTakeSnapshot} size={buttonSize} icon="📸" label="Photo" />
          {isCarMode && (
            <MobileActionButton
              onClick={() => setShowVehicleSelector(true)}
              size={buttonSize}
              icon="🔄"
              label="Vehicle"
            />
          )}
          {isCarMode && onToggleWipers && (
            <MobileActionButton
              onClick={onToggleWipers}
              active={wipersEnabled}
              size={buttonSize}
              icon="💧"
              label="Wipers"
            />
          )}
          {isCarMode && onToggleRoof && (
            <MobileActionButton
              onClick={onToggleRoof}
              active={isRoofOpen}
              size={buttonSize}
              icon="☀️"
              label="Roof"
            />
          )}
        </div>

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

      {showSettings && (
        <MobileSettingsSheet
          quality={quality}
          device={device}
          onClose={() => setShowSettings(false)}
          onToggleBatterySave={() => setBatterySaveMode(!quality.batterySaveMode)}
          onResetQuality={resetToOptimal}
        />
      )}

      {showVehicleSelector && (
        <MobileVehicleSheet
          vehicles={Object.values(VEHICLES)}
          currentVehicle={currentVehicle}
          onSelect={(v) => {
            onVehicleChange?.(v);
            setShowVehicleSelector(false);
          }}
          onClose={() => setShowVehicleSelector(false)}
        />
      )}

      {showHelp && <MobileHelpSheet onClose={() => setShowHelp(false)} />}
    </>
  );
};

export default MobileUI;
