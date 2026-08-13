import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlMode } from '../../hooks/useViewMode';
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
  isCarCenterDisplayHit,
  cycleCarDisplayPage,
  setCarWeather,
  isConvertibleOpen,
  gearHopCount,
  CarModeState,
  type GearPosition,
} from '../../car';
import { publishCameraSpeed, resetCameraSpeed } from '../../renderer/cameraMotionSignal';
import { VehicleDynamics, VehicleTelemetry } from '../../car/VehicleDynamics';
import { applyVehicleTelemetry } from '../../car/telemetryFeed';
import { CabinAudio } from '../../car/audio/CabinAudio';
import { SpringPhysics } from '../../animation/PhysicsAnimations';

export interface UseCarDashboardBridgeOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  registerCarModeState: (state: CarModeState) => void;
  controlMode: ControlMode;
  heading: number;
  pitch: number;
  carHeading: number;
  zoom: number;
  panorama: google.maps.StreetViewPanorama | null;
  position: google.maps.LatLng | null;
  canvas: HTMLCanvasElement | null;
  wipersEnabled: boolean;
  headlightsOn: boolean;
  domeLightOn: boolean;
  nightIntensity: number;
  rainIntensity: number;
  wind: number;
  fogDensity: number;
  snowIntensity: number;
  sunAltitude: number;
  isRoofOpen: boolean;
  windowTint: number;
  seatDistance: number;
  gearRef: React.MutableRefObject<GearPosition>;
}

export interface UseCarDashboardBridgeResult {
  telemetry: VehicleTelemetry;
  steeringInputRef: React.MutableRefObject<number>;
  isSteeringWheelAtPoint: (x: number, y: number) => boolean;
  handleDisplayMouseDown: (e: React.MouseEvent) => void;
  handleDisplayClick: (e: React.MouseEvent) => void;
  handleThrust: (direction: 'forward' | 'backward') => void;
  handleSteeringDelta: (delta: number) => void;
}

export function useCarDashboardBridge({
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
}: UseCarDashboardBridgeOptions): UseCarDashboardBridgeResult {
  const carModeStateRef = useRef<CarModeState | null>(null);
  const carHeadingRef = useRef(carHeading);
  carHeadingRef.current = carHeading;
  const headingRef = useRef(heading);
  headingRef.current = heading;
  const pitchRef = useRef(pitch);
  pitchRef.current = pitch;

  const steeringInputRef = useRef(0);
  const carSpeedRef = useRef(0);
  const dynamicsRef = useRef<VehicleDynamics | null>(null);
  if (!dynamicsRef.current) dynamicsRef.current = new VehicleDynamics();
  const [telemetry, setTelemetry] = useState<VehicleTelemetry>({
    speedKmh: 0, rpm: 850, gear: 'P', accelerating: false,
  });
  const lastTelemetryPushRef = useRef(0);
  const cabinAudioRef = useRef<CabinAudio | null>(null);
  const rollSpringRef = useRef(new SpringPhysics({ stiffness: 48, damping: 9, mass: 1 }));
  const pitchSpringRef = useRef(new SpringPhysics({ stiffness: 36, damping: 8, mass: 1 }));
  const prevPositionRef = useRef<google.maps.LatLng | null>(null);
  const bodyPitchRef = useRef(0);
  const bodyRollRef = useRef(0);
  const pitchImpulseRef = useRef(0);

  const displayPressRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (carModeStateRef.current) {
      toggleCarMode(true);
      return;
    }
    try {
      carModeStateRef.current = initCarMode(containerRef.current);
      registerCarModeState(carModeStateRef.current);
      toggleCarMode(true);
      const audio = new CabinAudio();
      cabinAudioRef.current = audio;
      void audio.start();
    } catch (err) {
      console.error('[CarModeView] Failed to initialize car mode:', err);
    }
    return () => {
      toggleCarMode(false);
      disposeCarMode();
      carModeStateRef.current = null;
      bodyPitchRef.current = 0;
      bodyRollRef.current = 0;
      pitchImpulseRef.current = 0;
      cabinAudioRef.current?.dispose();
      cabinAudioRef.current = null;
    };
  }, [containerRef, registerCarModeState]);

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

  useEffect(() => {
    if (!carModeStateRef.current) return;
    setCarWipers(wipersEnabled);
    carModeStateRef.current.interior.setInteriorLighting(
      headlightsOn,
      nightIntensity,
      domeLightOn,
    );
  }, [wipersEnabled, headlightsOn, domeLightOn, nightIntensity]);

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

  useEffect(() => {
    setCarInteriorEditMode(controlMode === 'uiMouse');
  }, [controlMode]);

  useEffect(() => {
    setCarWeather(rainIntensity / 100);
  }, [rainIntensity]);

  useEffect(() => {
    setMirrorStreetViewCanvas(canvas);
    return () => setMirrorStreetViewCanvas(null);
  }, [canvas]);

  useEffect(() => {
    setCarZoomFOV(zoom);
  }, [zoom]);

  useEffect(() => {
    setWindowTint(windowTint);
  }, [windowTint]);

  useEffect(() => {
    setCarSeatOffset(seatDistance);
  }, [seatDistance]);

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

      const headYawOffset = (headingRef.current - carHeadingRef.current + 540) % 360 - 180;
      const headPitch = pitchRef.current;

      if (panorama) {
        panorama.setPov({
          heading: headingRef.current,
          pitch: pitchRef.current,
        });
      }

      updateCarMode(
        carHeadingRef.current,
        headYawOffset,
        headPitch,
        carSpeedRef.current,
        nightIntensity,
        headlightsOn,
        domeLightOn,
        headingRef.current,
      );

      setCarSteering(steeringInputRef.current);

      dynamicsRef.current!.noteGear(String(gearRef.current));
      const telem = dynamicsRef.current!.update(deltaTime);
      carSpeedRef.current = telem.speedKmh;
      applyVehicleTelemetry(telem, { updateCluster: updateCarGauges });
      publishCameraSpeed(telem.speedKmh);
      cabinAudioRef.current?.update(telem, {
        openness: isRoofOpen || isConvertibleOpen() ? 1 : 0,
      });

      if (now - lastTelemetryPushRef.current > 150) {
        lastTelemetryPushRef.current = now;
        setTelemetry(telem);
      }

      if (steeringInputRef.current !== 0) {
        steeringInputRef.current *= 0.92;
        if (Math.abs(steeringInputRef.current) < 0.1) {
          steeringInputRef.current = 0;
        }
      }

      if (controlMode === 'carSteer') {
        const targetRoll = steeringInputRef.current * 0.04;
        bodyRollRef.current = rollSpringRef.current.update(deltaTime, targetRoll);
        const targetPitch = pitchImpulseRef.current + (carSpeedRef.current > 0 ? -0.5 : 0);
        bodyPitchRef.current = pitchSpringRef.current.update(deltaTime, targetPitch);
        pitchImpulseRef.current *= 0.92;
        bodyPitchRef.current = Math.max(-8, Math.min(8, bodyPitchRef.current));
      } else {
        // Free-look must not yaw or lean the chassis (#171).
        bodyRollRef.current = rollSpringRef.current.update(deltaTime, 0);
        bodyPitchRef.current = pitchSpringRef.current.update(deltaTime, 0);
        pitchImpulseRef.current = 0;
      }

      if (carModeStateRef.current) {
        carModeStateRef.current.interior.setCarOrientation(
          carHeadingRef.current,
          bodyPitchRef.current,
          bodyRollRef.current,
        );
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [panorama, nightIntensity, headlightsOn, domeLightOn, controlMode, isRoofOpen]);

  useEffect(() => {
    if (controlMode === 'freeLook') {
      dynamicsRef.current?.stop();
      resetCameraSpeed();
      carSpeedRef.current = 0;
      pitchImpulseRef.current = 0;
      steeringInputRef.current = 0;
      bodyPitchRef.current = 0;
      bodyRollRef.current = 0;
      rollSpringRef.current.reset(0);
      pitchSpringRef.current.reset(0);
    }
  }, [controlMode]);

  const isSteeringWheelAtPoint = useCallback((x: number, y: number): boolean => {
    return isCarSteeringWheelHit(x, y);
  }, []);

  const handleDisplayMouseDown = useCallback((e: React.MouseEvent) => {
    displayPressRef.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }, []);

  const handleDisplayClick = useCallback((e: React.MouseEvent) => {
    const press = displayPressRef.current;
    displayPressRef.current = null;
    if (!press) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > 6) return;
    if (isCarCenterDisplayHit(e.clientX, e.clientY)) {
      cycleCarDisplayPage();
    }
  }, []);

  const handleThrust = useCallback((direction: 'forward' | 'backward') => {
    if (controlMode === 'freeLook') return;
    if (gearHopCount(gearRef.current) === 0) return;
    pitchImpulseRef.current = direction === 'forward' ? -2 : 1;
    dynamicsRef.current?.noteThrust(direction);
    triggerCarInteriorPress(direction === 'forward' ? 'gasPedal' : 'brakePedal');
  }, [controlMode, gearRef]);

  const handleSteeringDelta = useCallback((delta: number) => {
    steeringInputRef.current = Math.max(-90, Math.min(90, steeringInputRef.current + delta));
  }, []);

  return {
    telemetry,
    steeringInputRef,
    isSteeringWheelAtPoint,
    handleDisplayMouseDown,
    handleDisplayClick,
    handleThrust,
    handleSteeringDelta,
  };
}
