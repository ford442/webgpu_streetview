import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useViewMode, ControlMode } from '../hooks/useViewMode';
import { useEnvironmentSettings } from '../hooks/useEnvironmentSettings';
import { useVehicleSettings } from '../hooks/useVehicleSettings';
import CarInputHandler from '../components/CarInputHandler';
import { AudioAnalyzer } from '../audio/AudioAnalyzer';
import { getTopStationForLocation } from '../services/radioBrowserService';
import {
  initCarMode,
  toggleCarMode,
  disposeCarMode,
  updateCarMode,
  setCarSteering,
  setCarWipers,
  updateCarGauges,
  isCarSteeringWheelHit,
  toggleWipers,
  setWindowTint,
  CarModeState
} from '../car';
import { DashboardUI } from '../car/DashboardUI';

interface CarModeViewProps {
  mapsApiKey: string;
}

/**
 * CarModeView - The car interior driving experience.
 * 
 * Features:
 * - Three.js car interior overlay with transparent background
 * - Multiple control modes (freeLook, uiMouse, carSteer)
 * - Temporary steering wheel mode switch (click wheel to temporarily steer)
 * - Dashboard UI with gauges, wipers, lights controls
 * - Head look independent of car steering
 */
const CarModeView: React.FC<CarModeViewProps> = () => {
  const { canvas, heading, pitch, panorama } = useStreetView();
  const {
    viewMode,
    toggleViewMode,
    controlMode,
    setControlMode,
    headCoupling,
    isTempSteerMode,
    carHeading,
    registerCarModeState,
  } = useViewMode();
  
  const {
    wipersEnabled,
    toggleWipers,
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
    timeOfDay,
    setTimeOfDay,
    nightIntensity,
    applyTimeOfDayPreset,
    ambientLightColor,
  } = useEnvironmentSettings();
  
  const {
    windowTint,
    setWindowTint: setVehicleWindowTint,
  } = useVehicleSettings();
  
  const containerRef = useRef<HTMLDivElement>(null);
  const carModeStateRef = useRef<CarModeState | null>(null);
  
  // Dashboard visibility state
  const [isDashboardVisible, setIsDashboardVisible] = useState(true);
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [stationName, setStationName] = useState('');
  const [stationTags, setStationTags] = useState('');
  
  // Audio analyzer ref
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  
  // GPS/Map state
  const [isMapOpen, setIsMapOpen] = useState(false);
  
  // Car state refs — carHeading, heading, pitch come from hooks; kept in sync for animate loop
  const carHeadingRef = useRef(carHeading);
  carHeadingRef.current = carHeading;
  const headingRef = useRef(heading);
  headingRef.current = heading;
  const pitchRef = useRef(pitch);
  pitchRef.current = pitch;

  const steeringInputRef = useRef(0);
  const carSpeedRef = useRef(0);
  const carRPMRef = useRef(0);
  const bodyPitchRef = useRef(0);
  const bodyRollRef = useRef(0);
  const pitchImpulseRef = useRef(0);
  
  // Initialize car mode
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Initialize car interior
    try {
      carModeStateRef.current = initCarMode(containerRef.current);
      registerCarModeState(carModeStateRef.current);
      toggleCarMode(true);
    } catch (err) {
      console.error('[CarModeView] Failed to initialize car mode:', err);
    }
    
    return () => {
      toggleCarMode(false);
      disposeCarMode();
      carModeStateRef.current = null;
      // Reset body physics so freelook starts perfectly level
      bodyPitchRef.current = 0;
      bodyRollRef.current = 0;
      pitchImpulseRef.current = 0;
    };
  }, [registerCarModeState]);
  
  // Sync environment settings to car interior
  useEffect(() => {
    if (!carModeStateRef.current) return;
    
    // Update wipers
    setCarWipers(wipersEnabled);
    
    // Update interior lighting
    carModeStateRef.current.interior.setInteriorLighting(
      headlightsOn,
      nightIntensity,
      domeLightOn
    );
  }, [wipersEnabled, headlightsOn, domeLightOn, nightIntensity]);
  
  // Sync window tint to car interior
  useEffect(() => {
    setWindowTint(windowTint);
  }, [windowTint]);
  
  // Animation loop for car mode
  useEffect(() => {
    if (!carModeStateRef.current) return;
    
    let active = true;
    let rafId: number;
    let lastTime = performance.now();
    
    const animate = () => {
      if (!active) return;
      
      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;
      
      // Calculate relative head look offset for 3D interior
      // headYawOffset is how much the head is turned relative to the car body
      let headYawOffset = (headingRef.current - carHeadingRef.current + 540) % 360 - 180;
      const headPitch = pitchRef.current;
      
      // Update panorama POV to follow viewer direction (world heading/pitch)
      if (panorama) {
        panorama.setPov({
          heading: headingRef.current,
          pitch: pitchRef.current
        });
      }

      // Update car interior
      updateCarMode(
        carHeadingRef.current,
        headYawOffset,
        headPitch,
        carSpeedRef.current,
        nightIntensity,
        headlightsOn,
        domeLightOn
      );
      
      // Update steering wheel
      setCarSteering(steeringInputRef.current);
      
      // Update gauges
      carRPMRef.current = Math.abs(steeringInputRef.current) * 100 + carSpeedRef.current * 50;
      updateCarGauges(carSpeedRef.current, carRPMRef.current);
      
      // Decay steering
      if (steeringInputRef.current !== 0) {
        steeringInputRef.current *= 0.92;
        if (Math.abs(steeringInputRef.current) < 0.1) {
          steeringInputRef.current = 0;
        }
      }
      
      // Decay speed
      if (carSpeedRef.current > 0) {
        carSpeedRef.current = Math.max(0, carSpeedRef.current - 5 * deltaTime);
      }
      
      // Body tilt physics: only in carSteer mode and clamped
      if (controlMode === 'carSteer') {
        // Roll from steering input (lean into turns)
        const targetRoll = steeringInputRef.current * 0.15;
        bodyRollRef.current += (targetRoll - bodyRollRef.current) * Math.min(deltaTime * 6, 1);
        
        // Pitch from acceleration impulse + ongoing speed
        const targetPitch = pitchImpulseRef.current + (carSpeedRef.current > 0 ? -1.5 : 0);
        bodyPitchRef.current += (targetPitch - bodyPitchRef.current) * Math.min(deltaTime * 4, 1);
        
        // Decay impulse and clamp pitch
        pitchImpulseRef.current *= 0.92;
        bodyPitchRef.current = Math.max(-8, Math.min(8, bodyPitchRef.current));
      } else {
        // Return to level when not in steering mode
        bodyRollRef.current += (0 - bodyRollRef.current) * Math.min(deltaTime * 6, 1);
        bodyPitchRef.current += (0 - bodyPitchRef.current) * Math.min(deltaTime * 6, 1);
        pitchImpulseRef.current = 0;
      }
      
      // Apply body orientation with dynamic tilt
      if (carModeStateRef.current) {
        carModeStateRef.current.interior.setCarOrientation(
          carHeadingRef.current,
          bodyPitchRef.current,
          bodyRollRef.current
        );
      }
      
      rafId = requestAnimationFrame(animate);
    };
    
    rafId = requestAnimationFrame(animate);
    
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [panorama, nightIntensity, headlightsOn, domeLightOn, controlMode]);
  
  // Handle steering wheel hit test
  const isSteeringWheelAtPoint = useCallback((x: number, y: number): boolean => {
    return isCarSteeringWheelHit(x, y);
  }, []);
  
  // Handle thrust from W/S keys for body pitch effect
  const handleThrust = useCallback((direction: 'forward' | 'backward') => {
    if (controlMode === 'freeLook') return; // Car is locked when looking around
    pitchImpulseRef.current = direction === 'forward' ? -5 : 3;
    carSpeedRef.current = direction === 'forward' ? 25 : 12;
  }, [controlMode]);

  // Handle steering deltas from CarInputHandler for wheel visual + body tilt
  const handleSteeringDelta = useCallback((delta: number) => {
    steeringInputRef.current = Math.max(-90, Math.min(90, steeringInputRef.current + delta));
  }, []);
  
  // Dashboard toggle handlers
  const handleToggleGPS = useCallback(() => {
    setIsMapOpen(prev => !prev);
  }, []);
  
  const handleToggleRadio = useCallback(async () => {
    const newState = !isRadioPlaying;
    setIsRadioPlaying(newState);
    
    if (newState) {
      // Start radio - initialize audio if needed
      if (!audioAnalyzerRef.current) {
        audioAnalyzerRef.current = new AudioAnalyzer();
      }
      
      // Try to fetch a local station based on current panorama position
      const pos = panorama?.getPosition();
      let streamUrl = 'https://stream.zeno.fm/ywcmn7hpha0uv';
      let name = 'Radio Garden';
      let tags = 'world, ambient';
      
      if (pos) {
        const station = await getTopStationForLocation(pos.lat(), pos.lng());
        if (station) {
          streamUrl = station.urlResolved || station.url;
          name = station.name;
          tags = station.tags;
        }
      }
      
      // Initialize with a stream URL if not already done
      if (!audioElement) {
        const initialized = await audioAnalyzerRef.current.init(streamUrl);
        if (initialized) {
          audioAnalyzerRef.current.setStationInfo(name, tags);
          await audioAnalyzerRef.current.start();
          setAudioElement(audioAnalyzerRef.current.getAudioElement());
          setAnalyserNode(audioAnalyzerRef.current.getAnalyser());
          setStationName(name);
          setStationTags(tags);
        }
      } else {
        // Already initialized, just start playing
        await audioAnalyzerRef.current.start();
        setAnalyserNode(audioAnalyzerRef.current.getAnalyser());
      }
    } else {
      // Stop radio
      audioAnalyzerRef.current?.stop();
    }
  }, [isRadioPlaying, audioElement, panorama]);
  
  // Reset body physics when entering freeLook so no residual tilt remains
  useEffect(() => {
    if (controlMode === 'freeLook') {
      carSpeedRef.current = 0;
      pitchImpulseRef.current = 0;
      steeringInputRef.current = 0;
      bodyPitchRef.current = 0;
      bodyRollRef.current = 0;
    }
  }, [controlMode]);

  // Cleanup audio analyzer on unmount
  useEffect(() => {
    return () => {
      audioAnalyzerRef.current?.dispose();
      audioAnalyzerRef.current = null;
    };
  }, []);
  
  const handleToggleVehicle = useCallback(() => {
    // Toggle between sedan and convertible
    // This would integrate with VehicleManager
    console.log('Toggle vehicle type');
  }, []);
  
  const handleTimeOfDayChange = useCallback((value: string) => {
    applyTimeOfDayPreset(value as 'day' | 'sunrise' | 'sunset' | 'night');
  }, [applyTimeOfDayPreset]);
  
  // Get control mode display name
  const getModeDisplayName = (mode: ControlMode): string => {
    switch (mode) {
      case 'freeLook': return 'Free Look';
      case 'uiMouse': return 'UI Mouse';
      case 'carSteer': return 'Car Steer';
    }
  };
  
  // Get control mode description
  const getModeDescription = (mode: ControlMode): string => {
    switch (mode) {
      case 'freeLook':
        return '🖱️ Mouse = Look 360° • Click wheel = Temp steer • A/D = Steer';
      case 'uiMouse':
        return '🖱️ Normal cursor • Use menus • Cruise continues';
      case 'carSteer':
        return '🚗 Mouse X = Steer • Mouse Y = Pitch • A/D = Steer';
    }
  };
  
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'transparent',
      }}
    >
      {/* Input handler */}
      <CarInputHandler
        targetRef={containerRef}
        isSteeringWheelAtPoint={isSteeringWheelAtPoint}
        onThrust={handleThrust}
        onSteeringDelta={handleSteeringDelta}
      />
      
      {/* Premium Car Dashboard */}
      <DashboardUI
        isVisible={isDashboardVisible}
        isRadioPlaying={isRadioPlaying}
        isMapOpen={isMapOpen}
        onToggleGPS={handleToggleGPS}
        onToggleRadio={handleToggleRadio}
        onRainIntensity={setRainIntensity}
        onSnowIntensity={setSnowIntensity}
        onWind={setWind}
        onTimeOfDay={handleTimeOfDayChange}
        onToggleRoof={toggleRoof}
        onToggleWipers={toggleWipers}
        onToggleVehicle={handleToggleVehicle}
        onToggleHeadlights={toggleHeadlights}
        onToggleHighBeam={toggleHighBeam}
        onToggleDomeLight={toggleDomeLight}
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
        timeOfDay={timeOfDay}
        audioElement={audioElement}
        analyser={analyserNode}
        nightIntensity={nightIntensity}
        ambientLightColor={ambientLightColor}
        stationName={stationName}
        stationTags={stationTags}
      />
      
      {/* Control Mode Indicator (small overlay) */}
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
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          marginBottom: '4px'
        }}>
          <span style={{ 
            width: '8px', 
            height: '8px', 
            borderRadius: '50%', 
            background: controlMode === 'freeLook' ? '#4CAF50' : controlMode === 'uiMouse' ? '#2196F3' : '#FF9800',
            boxShadow: `0 0 8px ${controlMode === 'freeLook' ? '#4CAF50' : controlMode === 'uiMouse' ? '#2196F3' : '#FF9800'}`
          }} />
          <span style={{ fontWeight: 600 }}>{getModeDisplayName(controlMode)}</span>
          {isTempSteerMode && (
            <span style={{ color: '#FFCC80', fontSize: '10px' }}>(Temp)</span>
          )}
        </div>
        <div style={{ fontSize: '10px', opacity: 0.7, lineHeight: '1.3' }}>
          {getModeDescription(controlMode)}
        </div>
        <div style={{ 
          display: 'flex', 
          gap: '4px', 
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid rgba(255,255,255,0.1)'
        }}>
          <button
            onClick={() => setControlMode('freeLook')}
            style={{
              flex: 1,
              padding: '4px 8px',
              background: controlMode === 'freeLook' ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: controlMode === 'freeLook' ? '#A5D6A7' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: '10px',
              transition: 'all 0.2s',
            }}
          >
            Free
          </button>
          <button
            onClick={() => setControlMode('uiMouse')}
            style={{
              flex: 1,
              padding: '4px 8px',
              background: controlMode === 'uiMouse' ? 'rgba(33,150,243,0.3)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: controlMode === 'uiMouse' ? '#90CAF9' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: '10px',
              transition: 'all 0.2s',
            }}
          >
            UI
          </button>
          <button
            onClick={() => setControlMode('carSteer')}
            style={{
              flex: 1,
              padding: '4px 8px',
              background: controlMode === 'carSteer' ? 'rgba(255,152,0,0.3)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: controlMode === 'carSteer' ? '#FFCC80' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: '10px',
              transition: 'all 0.2s',
            }}
          >
            Steer
          </button>
        </div>
      </div>
      
      {/* Steering wheel overlay - shows when steering */}
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
