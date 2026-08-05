import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useViewMode, ControlMode } from '../hooks/useViewMode';
import { useEnvironmentSettings } from '../hooks/useEnvironmentSettings';
import { useVehicleSettings, MAX_SEAT_DISTANCE } from '../hooks/useVehicleSettings';
import { usePanoInfoPanel } from '../hooks/usePanoInfoPanel';
import { useCabinEnvironment } from '../hooks/useCabinEnvironment';
import CarInputHandler from '../components/CarInputHandler';
import { AudioAnalyzer } from '../audio/AudioAnalyzer';
import { publishCameraSpeed, resetCameraSpeed } from '../renderer/cameraMotionSignal';
import { getTopStationForLocation } from '../services/radioBrowserService';
import {
  initCarMode,
  toggleCarMode,
  disposeCarMode,
  updateCarMode,
  setCarSteering,
  setCarWipers,
  setCarSeatOffset,
  updateCarGauges,
  isCarSteeringWheelHit,
  setWindowTint,
  setMirrorStreetViewCanvas,
  setCarZoomFOV,
  setCarWeatherAmbient,
  setCarInteriorEditMode,
  triggerCarInteriorPress,
  handleCarInteriorPointerDown,
  handleCarInteriorPointerMove,
  handleCarInteriorPointerUp,
  isConvertibleOpen,
  setCarMediaInfo,
  isCarCenterDisplayHit,
  cycleCarDisplayPage,
  setCarWeather,
  setCabinLeverHandlers,
  cycleWiperStalk,
  setCarGear,
  gearHopCount,
  GEAR_POSITIONS,
  CarModeState,
  type GearPosition,
  type WiperStalkPosition,
} from '../car';
import { DashboardUI } from '../car/DashboardUI';
import { VehicleDynamics, VehicleTelemetry } from '../car/VehicleDynamics';

interface CarModeViewProps {
  mapsApiKey: string;
}

type HudMode = 'full' | 'compact' | 'immersive';

const HUD_MODE_STORAGE_KEY = 'webgpu_streetview_car_hud_mode';
const HUD_LONG_PRESS_MS = 500;
/** Spacing between the extra panorama hops a 2/3 gear queues. */
const GEAR_HOP_INTERVAL_MS = 550;

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

  // Feed the dashboard location readout (road/area, coords, heading, capture date).
  usePanoInfoPanel(panorama, position, heading);

  // Cabin lighting from the surrounding panorama (IBL) + the real sun.
  useCabinEnvironment(panorama, position);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const carModeStateRef = useRef<CarModeState | null>(null);
  
  const [hudMode, setHudMode] = useState<HudMode>(() => {
    if (typeof window === 'undefined') return 'compact';
    const saved = window.localStorage.getItem(HUD_MODE_STORAGE_KEY);
    if (saved === 'full' || saved === 'compact' || saved === 'immersive') return saved;
    return 'compact';
  });
  const hudLongPressTimerRef = useRef<number | null>(null);
  const hudLongPressTriggeredRef = useRef(false);
  const setHudModeAndPersist = useCallback((nextMode: HudMode) => {
    setHudMode(nextMode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HUD_MODE_STORAGE_KEY, nextMode);
    }
  }, []);
  const toggleDashboard = useCallback(() => {
    setHudModeAndPersist(hudMode === 'full' ? 'compact' : 'full');
  }, [hudMode, setHudModeAndPersist]);
  const handleHudShortToggle = useCallback(() => {
    if (hudMode === 'immersive') {
      setHudModeAndPersist('compact');
      return;
    }
    setHudModeAndPersist(hudMode === 'full' ? 'compact' : 'full');
  }, [hudMode, setHudModeAndPersist]);
  const handleHudKeyDown = useCallback(() => {
    if (hudLongPressTimerRef.current !== null) return;
    hudLongPressTriggeredRef.current = false;
    hudLongPressTimerRef.current = window.setTimeout(() => {
      hudLongPressTriggeredRef.current = true;
      setHudModeAndPersist('immersive');
      hudLongPressTimerRef.current = null;
    }, HUD_LONG_PRESS_MS);
  }, [setHudModeAndPersist]);
  const handleHudKeyUp = useCallback(() => {
    if (hudLongPressTimerRef.current !== null) {
      window.clearTimeout(hudLongPressTimerRef.current);
      hudLongPressTimerRef.current = null;
    }
    if (!hudLongPressTriggeredRef.current) {
      handleHudShortToggle();
    }
    hudLongPressTriggeredRef.current = false;
  }, [handleHudShortToggle]);
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [stationName, setStationName] = useState('');
  const [stationTags, setStationTags] = useState('');
  
  // Audio analyzer ref
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  
  // GPS/Map state
  const [isMapOpen, setIsMapOpen] = useState(false);

  // Physical cabin levers: the 3D stalk/shifter own this state, the HUD rows
  // below are thin fallbacks for keyboard users and non-raycastable modes.
  const [wiperStalk, setWiperStalkState] = useState<WiperStalkPosition>('off');
  const [gear, setGearState] = useState<GearPosition>('D');
  const gearRef = useRef<GearPosition>('D');
  gearRef.current = gear;
  /** Timers for the extra hops a 2/3 gear queues after the first advance. */
  const pendingHopsRef = useRef<number[]>([]);
  /** Hop multiplier currently being served (0 when not multi-hopping). */
  const [chainingHops, setChainingHops] = useState(0);

  const cancelPendingHops = useCallback(() => {
    for (const id of pendingHopsRef.current) window.clearTimeout(id);
    pendingHopsRef.current = [];
    setChainingHops(0);
  }, []);

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
  // Speed/RPM/gear model fed by pano hops (GPS velocity) and thrust keys.
  const dynamicsRef = useRef<VehicleDynamics | null>(null);
  if (!dynamicsRef.current) dynamicsRef.current = new VehicleDynamics();
  const [telemetry, setTelemetry] = useState<VehicleTelemetry>({
    speedKmh: 0, rpm: 850, gear: 'P', accelerating: false,
  });
  const lastTelemetryPushRef = useRef(0);
  const prevPositionRef = useRef<google.maps.LatLng | null>(null);
  const bodyPitchRef = useRef(0);
  const bodyRollRef = useRef(0);
  const pitchImpulseRef = useRef(0);
  
  // Initialize car mode
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Guard against double-init (React Strict Mode remounts, rapid toggles)
    if (carModeStateRef.current) {
      toggleCarMode(true);
      return;
    }
    
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
  
  // Infer GPS velocity from panorama hops: each position change reports its
  // travel distance, so cruise mode / repeated advances read as real speed.
  useEffect(() => {
    const prev = prevPositionRef.current;
    prevPositionRef.current = position;
    if (!prev || !position) return;
    const toRad = Math.PI / 180;
    const dLat = (position.lat() - prev.lat()) * toRad;
    const dLng = (position.lng() - prev.lng()) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(prev.lat() * toRad) * Math.cos(position.lat() * toRad) * Math.sin(dLng / 2) ** 2;
    const distanceMeters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    dynamicsRef.current?.notePanoHop(distanceMeters);
  }, [position]);

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

  // Weather-reactive cabin glass + ambience
  useEffect(() => {
    setCarWeatherAmbient({
      rainIntensity,
      wind,
      fogDensity,
      snowIntensity,
      sunAltitude,
      lightShaftFactor: Math.max(0, sunAltitude / 0.35) * (1 - fogDensity / 150),
      convertibleOpen: isConvertibleOpen(),
    });
  }, [rainIntensity, wind, fogDensity, snowIntensity, sunAltitude, isRoofOpen]);

  // UI Mouse mode = interior edit (3D knobs/buttons); Shift temporarily in freeLook too
  useEffect(() => {
    setCarInteriorEditMode(controlMode === 'uiMouse');
  }, [controlMode]);
  
  // Rain dims/diffuses the cabin daylight and enables windshield droplets
  useEffect(() => {
    setCarWeather(rainIntensity / 100);
  }, [rainIntensity]);

  // Keep the centre display's media page in sync with the radio
  useEffect(() => {
    setCarMediaInfo(stationName, stationTags, isRadioPlaying);
  }, [stationName, stationTags, isRadioPlaying]);

  // Keep rearview mirror fed from the scraped Street View canvas
  useEffect(() => {
    setMirrorStreetViewCanvas(canvas);
    return () => setMirrorStreetViewCanvas(null);
  }, [canvas]);

  // Sync Three.js camera FOV with WebGPU zoom so window frames line up with the panorama
  useEffect(() => {
    setCarZoomFOV(zoom);
  }, [zoom]);

  // Sync window tint to car interior
  useEffect(() => {
    setWindowTint(windowTint);
  }, [windowTint]);

  // Sync driver seat distance (camera pullback off the dashboard) to car interior
  useEffect(() => {
    setCarSeatOffset(seatDistance);
  }, [seatDistance]);

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

      // Head/camera orientation for looking around inside the cabin.
      // Camera rotates locally on driverSeatGroup — dashboard stays fixed.
      updateCarMode(
        carHeadingRef.current,
        headYawOffset,
        headPitch,
        carSpeedRef.current,
        nightIntensity,
        headlightsOn,
        domeLightOn,
        headingRef.current
      );
      
      // Update steering wheel
      setCarSteering(steeringInputRef.current);
      
      // Vehicle dynamics → 3D cluster needles + compact DOM telemetry chip
      const telem = dynamicsRef.current!.update(deltaTime);
      carSpeedRef.current = telem.speedKmh;
      carRPMRef.current = telem.rpm;
      updateCarGauges(telem.speedKmh, telem.rpm);
      // Feed the WebGPU post pass so speed-coupled motion blur can react
      // without re-rendering the canvas at frame rate.
      publishCameraSpeed(telem.speedKmh);
      // Throttle React state pushes for the compact HUD telemetry chip.
      if (now - lastTelemetryPushRef.current > 150) {
        lastTelemetryPushRef.current = now;
        setTelemetry(telem);
      }
      
      // Decay steering
      if (steeringInputRef.current !== 0) {
        steeringInputRef.current *= 0.92;
        if (Math.abs(steeringInputRef.current) < 0.1) {
          steeringInputRef.current = 0;
        }
      }
      
      // Body tilt physics: only in carSteer mode and clamped
      if (controlMode === 'carSteer') {
        // Roll from steering input (lean into turns) — dampened for comfort
        const targetRoll = steeringInputRef.current * 0.04;
        bodyRollRef.current += (targetRoll - bodyRollRef.current) * Math.min(deltaTime * 6, 1);
        
        // Pitch from acceleration impulse + ongoing speed — dampened for comfort
        const targetPitch = pitchImpulseRef.current + (carSpeedRef.current > 0 ? -0.5 : 0);
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
        // Car body yaw is ALWAYS driven by carHeading, never by camera heading.
        // This keeps the dashboard, steering wheel, and A-pillars stationary
        // while the head looks around independently in freeLook mode.
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

  // Click (press-release without drag) on the centre display cycles its page.
  const displayPressRef = useRef<{ x: number; y: number } | null>(null);
  const handleDisplayMouseDown = useCallback((e: React.MouseEvent) => {
    displayPressRef.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }, []);
  const handleDisplayClick = useCallback((e: React.MouseEvent) => {
    const press = displayPressRef.current;
    displayPressRef.current = null;
    if (!press) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > 6) return; // was a look/steer drag, not a tap
    if (isCarCenterDisplayHit(e.clientX, e.clientY)) {
      cycleCarDisplayPage();
    }
  }, []);
  
  // Handle thrust from W/S keys for body pitch effect
  const handleThrust = useCallback((direction: 'forward' | 'backward') => {
    if (controlMode === 'freeLook') return; // Car is locked when looking around
    if (gearHopCount(gearRef.current) === 0) return; // Parked in P/N
    pitchImpulseRef.current = direction === 'forward' ? -2 : 1;
    dynamicsRef.current?.noteThrust(direction);
    triggerCarInteriorPress(direction === 'forward' ? 'gasPedal' : 'brakePedal');
  }, [controlMode]);

  // Handle steering deltas from CarInputHandler for wheel visual + body tilt
  const handleSteeringDelta = useCallback((delta: number) => {
    steeringInputRef.current = Math.max(-90, Math.min(90, steeringInputRef.current + delta));
  }, []);
  
  // Dashboard toggle handlers
  const handleToggleGPS = useCallback(() => {
    setIsMapOpen(prev => !prev);
  }, []);

  /**
   * Gear-aware movement: P/N hold the car still, R flips forward/backward, and
   * D/2/3 consume 1/2/3 panorama hops per input. The extra hops are queued
   * rather than fired at once so each one starts from the panorama the
   * previous hop landed on.
   */
  const handleNavigate = useCallback((direction: 'forward' | 'backward' | 'left' | 'right') => {
    const selected = gearRef.current;
    const hops = gearHopCount(selected);
    if (hops === 0) return;

    let resolved = direction;
    if (selected === 'R') {
      if (direction === 'forward') resolved = 'backward';
      else if (direction === 'backward') resolved = 'forward';
    }

    cancelPendingHops();
    advance(resolved, carHeading);
    // Only forward/backward travel multiplies; turns stay a single hop.
    if ((resolved !== 'forward' && resolved !== 'backward') || hops < 2) return;

    setChainingHops(hops);
    for (let i = 1; i < hops; i++) {
      const id = window.setTimeout(() => {
        if (gearRef.current !== selected) return;
        advance(resolved, carHeadingRef.current);
        if (i === hops - 1) setChainingHops(0);
      }, i * GEAR_HOP_INTERVAL_MS);
      pendingHopsRef.current.push(id);
    }
  }, [advance, carHeading, cancelPendingHops]);

  // Keep the HUD, app state and 3D levers in step when the driver grabs a
  // stalk or the shifter in the cabin.
  useEffect(() => {
    setCabinLeverHandlers({
      onWiperStalk: (position) => {
        setWiperStalkState(position);
        setWipers(position !== 'off');
      },
      onGear: (next) => {
        cancelPendingHops();
        setGearState(next);
      },
    });
    return () => setCabinLeverHandlers({});
  }, [setWipers, cancelPendingHops]);

  useEffect(() => cancelPendingHops, [cancelPendingHops]);

  // HUD fallbacks — drive the same API the physical levers do.
  const handleCycleWipers = useCallback(() => {
    const next = cycleWiperStalk();
    setWiperStalkState(next);
    setWipers(next !== 'off');
  }, [setWipers]);

  const handleSelectGear = useCallback((next: GearPosition) => {
    cancelPendingHops();
    setGearState(next);
    setCarGear(next);
  }, [cancelPendingHops]);
  
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
      dynamicsRef.current?.stop();
      resetCameraSpeed();
      carSpeedRef.current = 0;
      pitchImpulseRef.current = 0;
      steeringInputRef.current = 0;
      bodyPitchRef.current = 0;
      bodyRollRef.current = 0;
    }
  }, [controlMode]);

  useEffect(() => () => {
    if (hudLongPressTimerRef.current !== null) {
      window.clearTimeout(hudLongPressTimerRef.current);
      hudLongPressTimerRef.current = null;
    }
  }, []);

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
        return '🖱️ Click-drag = look around • A/D = turn head • Car stays put • Click wheel = steer';
      case 'uiMouse':
        return '🖱️ Dashboard controls • Click cabin knobs/buttons • Right-drag = steer • H = switch mode';
      case 'carSteer':
        return '🚗 Click-drag X = steer car • drag Y = look up/down • W/S = drive • Q/E = snap ±45°';
    }
  };
  
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
      {/* Input handler */}
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
      
      {/* Premium Car Dashboard */}
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
      
      {/* Multi-hop chip — shows the gear's hop multiplier while a 2/3 gear is
          working through the extra panorama hops it queued. */}
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
          // The root container gets pointerEvents:'none' in uiMouse to let clicks reach the
          // dashboard. This overlay must explicitly opt back in so users can always switch modes.
          pointerEvents: 'auto',
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
      
      {/* Lever fallbacks — the cabin stalk/shifter are the primary controls, but
          free-look and keyboard-only users still need to reach them. */}
      {hudMode !== 'immersive' && (
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
            {GEAR_POSITIONS.map((option) => (
              <button
                key={option}
                onClick={() => handleSelectGear(option)}
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
            onClick={handleCycleWipers}
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
      )}

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
