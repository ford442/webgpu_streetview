import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useViewMode } from '../hooks/useViewMode';
import { useEnvironmentSettings } from '../hooks/useEnvironmentSettings';
import { useVehicleSettings, MAX_SEAT_DISTANCE } from '../hooks/useVehicleSettings';
import { usePanoInfoPanel } from '../hooks/usePanoInfoPanel';
import { useCabinEnvironment } from '../hooks/useCabinEnvironment';
import { useRearViewFeed } from '../hooks/useRearViewFeed';
import CarInputHandler from '../components/CarInputHandler';
import {
  handleCarInteriorPointerDown,
  handleCarInteriorPointerMove,
  handleCarInteriorPointerUp,
} from '../car';
import { DashboardUI } from '../car/DashboardUI';
import { useCarHudMode } from './car/useCarHudMode';
import { useCruiseFlag } from '../hooks/CruiseFlagContext';
import { useGearHopAdvance } from './car/useGearHopAdvance';
import { useCabinRadioBinding } from './car/useCabinRadioBinding';
import { useCarDashboardBridge } from './car/useCarDashboardBridge';
import { CarControlModeOverlay } from './car/CarControlModeOverlay';
import { CarLeverFallbacks } from './car/CarLeverFallbacks';

interface CarModeViewProps {
  mapsApiKey: string;
}

/**
 * CarModeView — composition layer for the car interior driving experience.
 * Controllers live in `src/views/car/*` hooks; this file wires providers + UI only.
 */
const CarModeView: React.FC<CarModeViewProps> = ({ mapsApiKey }) => {
  const { heading, pitch, panorama, advance, canvas, zoom, position } = useStreetView();
  const {
    controlMode,
    setControlMode,
    isTempSteerMode,
    carHeading,
    registerCarModeState,
  } = useViewMode();

  const {
    wipersEnabled,
    setWipers,
    headlightsOn,
    toggleHeadlights,
    highBeam,
    toggleHighBeam,
    domeLightOn,
    toggleDomeLight,
    isRoofOpen,
    toggleRoof,
    rainIntensity,
    setRainIntensity,
    snowIntensity,
    setSnowIntensity,
    wind,
    setWind,
    fogDensity,
    timeOfDay,
    nightIntensity,
    applyTimeOfDayPreset,
    ambientLightColor,
    sunAltitude,
  } = useEnvironmentSettings();

  const {
    windowTint,
    setWindowTint: setVehicleWindowTint,
    seatDistance,
    setSeatDistance,
  } = useVehicleSettings();

  usePanoInfoPanel(panorama, position, heading);
  useCabinEnvironment(panorama, position);

  const rearFeed = useRearViewFeed({ apiKey: mapsApiKey, active: true });

  const containerRef = useRef<HTMLDivElement>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const isCruiseMode = useCruiseFlag();
  const {
    hudMode,
    setHudModeAndPersist,
    toggleDashboard,
    handleHudKeyDown,
    handleHudKeyUp,
  } = useCarHudMode({ isCruiseMode });

  const {
    gear,
    gearRef,
    wiperStalk,
    chainingHops,
    gearPositions,
    handleNavigate,
    handleCycleWipers,
    handleSelectGear,
  } = useGearHopAdvance({ advance, carHeading, setWipers });

  const {
    isRadioPlaying,
    audioElement,
    analyserNode,
    stationName,
    stationTags,
    handleToggleRadio,
  } = useCabinRadioBinding({ panorama });

  const {
    telemetry,
    steeringInputRef,
    isSteeringWheelAtPoint,
    handleDisplayMouseDown,
    handleDisplayClick,
    handleThrust,
    handleSteeringDelta,
  } = useCarDashboardBridge({
    containerRef,
    registerCarModeState,
    controlMode,
    heading,
    pitch,
    carHeading,
    zoom,
    panorama,
    position,
    canvas,
    wipersEnabled,
    headlightsOn,
    domeLightOn,
    nightIntensity,
    rainIntensity,
    wind,
    fogDensity,
    snowIntensity,
    sunAltitude,
    isRoofOpen,
    windowTint,
    seatDistance,
    gearRef,
  });

  const { enabled: rearFeedEnabled, notifyPose: notifyRearPose } = rearFeed;
  useEffect(() => {
    if (!rearFeedEnabled || !position) return;
    const panoId = panorama?.getPano?.();
    notifyRearPose({
      lat: position.lat(),
      lng: position.lng(),
      carHeading,
      ...(panoId ? { panoId } : {}),
    });
  }, [rearFeedEnabled, notifyRearPose, position, panorama, carHeading]);

  const handleToggleGPS = useCallback(() => {
    setIsMapOpen((prev) => !prev);
  }, []);

  const handleToggleVehicle = useCallback(() => {
    console.log('Toggle vehicle type');
  }, []);

  const handleTimeOfDayChange = useCallback((value: string) => {
    applyTimeOfDayPreset(value as 'day' | 'sunrise' | 'sunset' | 'night');
  }, [applyTimeOfDayPreset]);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleDisplayMouseDown}
      onClick={handleDisplayClick}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'transparent',
        pointerEvents: 'auto',
        cursor: controlMode === 'uiMouse' ? 'default' : controlMode === 'carSteer' ? 'ew-resize' : 'default',
      }}
    >
      <CarInputHandler
        targetRef={containerRef}
        isSteeringWheelAtPoint={isSteeringWheelAtPoint}
        onThrust={handleThrust}
        onSteeringDelta={handleSteeringDelta}
        onHudKeyDown={handleHudKeyDown}
        onHudKeyUp={handleHudKeyUp}
        onInteriorPointerDown={(x, y, edit) => handleCarInteriorPointerDown(x, y, edit)}
        onInteriorPointerMove={(x, y) => handleCarInteriorPointerMove(x, y)}
        onInteriorPointerUp={() => handleCarInteriorPointerUp()}
        interiorEditMode={controlMode === 'uiMouse'}
      />

      <DashboardUI
        isVisible
        hudMode={hudMode}
        isRadioPlaying={isRadioPlaying}
        isMapOpen={isMapOpen}
        onNavigate={handleNavigate}
        onToggleGPS={handleToggleGPS}
        onToggleRadio={handleToggleRadio}
        onRainIntensity={setRainIntensity}
        onSnowIntensity={setSnowIntensity}
        onWind={setWind}
        onTimeOfDay={handleTimeOfDayChange}
        onToggleRoof={toggleRoof}
        onToggleWipers={handleCycleWipers}
        onToggleVehicle={handleToggleVehicle}
        onToggleHeadlights={toggleHeadlights}
        onToggleHighBeam={toggleHighBeam}
        onToggleDomeLight={toggleDomeLight}
        onToggleRearFeed={rearFeed.toggle}
        rearFeedEnabled={rearFeed.enabled}
        rearFeedStatus={rearFeed.status}
        isRoofOpen={isRoofOpen}
        wipersEnabled={wipersEnabled}
        headlightsOn={headlightsOn}
        highBeam={highBeam}
        domeLightOn={domeLightOn}
        currentVehicle="sedan"
        rainIntensity={rainIntensity}
        snowIntensity={snowIntensity}
        wind={wind}
        windowTint={windowTint}
        onWindowTint={setVehicleWindowTint}
        seatDistance={seatDistance}
        maxSeatDistance={MAX_SEAT_DISTANCE}
        onSeatDistance={setSeatDistance}
        timeOfDay={timeOfDay}
        audioElement={audioElement}
        analyser={analyserNode}
        nightIntensity={nightIntensity}
        ambientLightColor={ambientLightColor}
        stationName={stationName}
        stationTags={stationTags}
        speedKmh={telemetry.speedKmh}
        rpm={telemetry.rpm}
        gear={gear === 'D' || gear === '2' || gear === '3' ? telemetry.gear : gear}
      />

      {chainingHops > 1 && (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Advancing ${chainingHops} panoramas`}
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '4px 12px',
            background: 'rgba(0, 212, 255, 0.18)',
            border: '1px solid rgba(0,212,255,0.5)',
            borderRadius: '999px',
            color: '#00d4ff',
            fontFamily: "'SF Pro Display', system-ui, sans-serif",
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            zIndex: 102,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          ×{chainingHops}
        </div>
      )}

      <CarControlModeOverlay
        controlMode={controlMode}
        isTempSteerMode={isTempSteerMode}
        hudMode={hudMode}
        setControlMode={setControlMode}
        setHudModeAndPersist={setHudModeAndPersist}
        toggleDashboard={toggleDashboard}
      />

      <CarLeverFallbacks
        hudMode={hudMode}
        gear={gear}
        gearPositions={gearPositions}
        wiperStalk={wiperStalk}
        onSelectGear={handleSelectGear}
        onCycleWipers={handleCycleWipers}
      />

      <div style={{
        position: 'absolute',
        bottom: '80px',
        left: '50%',
        transform: `translateX(-50%) rotate(${-steeringInputRef.current}deg)`,
        width: '120px',
        height: '120px',
        pointerEvents: 'none',
        zIndex: 90,
        opacity: Math.abs(steeringInputRef.current) > 5 ? 0.7 : 0.3,
        transition: 'opacity 0.2s ease',
      }}>
        <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
          <circle cx="50" cy="50" r="45" fill="none" stroke="#444" strokeWidth="8" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="#666" strokeWidth="2" opacity="0.5" />
          <circle cx="50" cy="50" r="10" fill="#333" stroke="#555" strokeWidth="2" />
          <line x1="50" y1="50" x2="50" y2="10" stroke="#555" strokeWidth="4" />
          <line x1="50" y1="50" x2="85" y2="65" stroke="#555" strokeWidth="4" />
          <line x1="50" y1="50" x2="15" y2="65" stroke="#555" strokeWidth="4" />
        </svg>
      </div>
    </div>
  );
};

export default CarModeView;
