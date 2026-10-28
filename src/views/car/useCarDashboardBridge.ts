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
  getCurrentVehicleType,
  gearHopCount,
  type CarModeState,
  type GearPosition,
} from '../../car';
import { publishCameraSpeed } from '../../renderer/cameraMotionSignal';
import { VehicleDynamics, type VehicleTelemetry } from '../../car/VehicleDynamics';
import { applyVehicleTelemetry } from '../../car/telemetryFeed';
import { CabinAudio, type CabinEnvironment } from '../../car/audio/CabinAudio';
import {
  createCabinRendererAsync,
  preloadWebGPUCabinRenderer,
  resolveCabinRendererPreference,
} from '../../car/interior/createCabinRenderer';
import { detectGPUProfile } from '../../car/interior/performance';
import { currentSearch } from '../../config/flags';
import { povStore, usePovEffect } from '../../state/povStore';
import { cabinHeadStore } from '../../state/cabinHeadStore';
import { createCabinPovSync } from '../../car/input/cabinPovSync';
import { frameTailScheduler } from '../../renderer/reproject/frameTail';
import { STEER_HEAD_RECENTER_RATE, dampTowardZero } from '../../car/carSpatialModel';
import { cancelFrame, isXrDriven, requestFrame } from '../../xr/frameClock';
import { tripStore } from '../../state/tripStore';
import { liveConditionsStore } from '../../state/liveConditionsStore';

/**
 * The world the cabin engine hears, read imperatively once per frame: the
 * weather panel (which live conditions drive while live), the live
 * precipitation/wind themselves, and the routed trip's cruise pace.
 */
function readCabinEnvironment(
  { rainIntensity, wind, wipersEnabled }: Pick<CabinEnvironment, 'rainIntensity' | 'wind' | 'wipersEnabled'>,
): CabinEnvironment {
  const live = liveConditionsStore.get();
  const conditions = live.status === 'live' ? live.conditions : null;
  const trip = tripStore.get();
  return {
    rainIntensity,
    wind,
    wipersEnabled,
    livePrecipitationMm: conditions?.precipitationMm ?? null,
    liveWindKmh: conditions?.windSpeedKmh ?? null,
    tripSpeedMps: trip.status === 'driving' ? trip.progress?.avgSpeedMps ?? null : null,
  };
}

export interface UseCarDashboardBridgeOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  registerCarModeState: (state: CarModeState) => void;
  /** Street View's shared `GPUDevice` — see `createCabinRenderer.ts`. */
  sharedGpuDevice?: GPUDevice;
  controlMode: ControlMode;
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
  isDashboardControlAtPoint: (x: number, y: number) => boolean;
  handleDisplayMouseDown: (e: React.MouseEvent) => void;
  handleDisplayClick: (e: React.MouseEvent) => void;
  handleThrust: (direction: 'forward' | 'backward') => void;
  handleSteeringDelta: (delta: number) => void;
}

export function useCarDashboardBridge({
  containerRef,
  registerCarModeState,
  sharedGpuDevice,
  controlMode,
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

  const steeringInputRef = useRef(0);
  const carSpeedRef = useRef(0);
  const dynamicsRef = useRef<VehicleDynamics | null>(null);
  if (!dynamicsRef.current) dynamicsRef.current = new VehicleDynamics();
  const [telemetry, setTelemetry] = useState<VehicleTelemetry>({
    speedKmh: 0, rpm: 850, gear: 'P', accelerating: false,
  });
  const lastTelemetryPushRef = useRef(0);
  const cabinAudioRef = useRef<CabinAudio | null>(null);
  // Read by the frame loop; a ref so a weather slider drag does not restart it.
  const cabinWeatherRef = useRef({ rainIntensity, wind, wipersEnabled });
  const prevPositionRef = useRef<google.maps.LatLng | null>(null);
  // One sync for the life of the view (it remembers what it last wrote, to
  // tell its own writes from a tour/shared-session aiming the view).
  const povSyncRef = useRef(createCabinPovSync());

  const displayPressRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (carModeStateRef.current) {
      toggleCarMode(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      // Default cabin is WebGPU on capable adapters. Preload the further-lazy
      // `three/webgpu` + TSL chunk, await renderer.init(), and fall back to a
      // WebGL overlay if either step fails. Street View weather stays up.
      let readyHandle: Awaited<ReturnType<typeof createCabinRendererAsync>> | undefined;
      if (resolveCabinRendererPreference(currentSearch()) === 'webgpu') {
        await preloadWebGPUCabinRenderer().catch((err) => {
          console.error('[CarModeView] Failed to preload the WebGPU cabin renderer; falling back to WebGL.', err);
        });
        readyHandle = await createCabinRendererAsync({
          gpuProfile: detectGPUProfile(),
          sharedDevice: sharedGpuDevice,
          search: currentSearch(),
        });
      }
      if (cancelled || !containerRef.current) {
        if (readyHandle) {
          try { readyHandle.renderer.dispose(); } catch { /* overlay never mounted */ }
        }
        return;
      }
      try {
        carModeStateRef.current = initCarMode(
          containerRef.current,
          undefined,
          sharedGpuDevice,
          readyHandle,
        );
        registerCarModeState(carModeStateRef.current);
        toggleCarMode(true);
        const audio = new CabinAudio();
        cabinAudioRef.current = audio;
        void audio.start();
      } catch (err) {
        console.error('[CarModeView] Failed to initialize car mode:', err);
      }
    })();
    return () => {
      cancelled = true;
      toggleCarMode(false);
      disposeCarMode();
      carModeStateRef.current = null;
      cabinAudioRef.current?.dispose();
      cabinAudioRef.current = null;
    };
    // sharedGpuDevice: re-run if it flips from undefined to a real device
    // (WebGPU init can still be resolving when car mode first mounts) — the
    // WebGPU cabin path must not get stuck on the WebGL overlay for the
    // rest of the session just because it lost that race once.
  }, [containerRef, registerCarModeState, sharedGpuDevice]);

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
    setCarInteriorEditMode(controlMode === 'UI_INTERACT');
  }, [controlMode]);

  useEffect(() => {
    setCarWeather(rainIntensity / 100);
  }, [rainIntensity]);

  useEffect(() => {
    cabinWeatherRef.current = { rainIntensity, wind, wipersEnabled };
  }, [rainIntensity, wind, wipersEnabled]);

  useEffect(() => {
    setMirrorStreetViewCanvas(canvas);
    return () => setMirrorStreetViewCanvas(null);
  }, [canvas]);

  usePovEffect((p) => p.zoom, setCarZoomFOV);

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

    const animate = (frameTime?: number) => {
      if (!active) return;
      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;

      // STEER: the head drifts back to centre, frame-rate independent — not
      // while a headset is the head (#331): its pose is the user's own.
      if (controlMode === 'STEER' && !isXrDriven()) {
        const { headYaw, headPitch } = cabinHeadStore.get();
        const settle = (x: number) => {
          const next = dampTowardZero(x, STEER_HEAD_RECENTER_RATE, Math.min(deltaTime, 0.1));
          return Math.abs(next) < 1e-4 ? 0 : next;
        };
        cabinHeadStore.set({ headYaw: settle(headYaw), headPitch: settle(headPitch) });
      }

      // The one place the Street View POV is set in car mode: derived from
      // carHeading + head pose, written to povStore, forwarded to Maps by
      // useStreetView (which honours hold-pause).
      povSyncRef.current.sync();

      const head = cabinHeadStore.get();
      updateCarMode(
        povStore.get().carHeading,
        head.headYaw,
        head.headPitch,
        carSpeedRef.current,
        nightIntensity,
        headlightsOn,
        domeLightOn,
      );
      // The cabin for this display frame is drawn: release the road frame's
      // tail (late latch, renderer/reproject/frameTail.ts) to present with it.
      if (frameTime !== undefined) frameTailScheduler.producerDone(frameTime);

      setCarSteering(steeringInputRef.current);

      dynamicsRef.current!.noteGear(String(gearRef.current));
      const telem = dynamicsRef.current!.update(deltaTime);
      carSpeedRef.current = telem.speedKmh;
      applyVehicleTelemetry(telem, { updateCluster: updateCarGauges });
      publishCameraSpeed(telem.speedKmh);
      cabinAudioRef.current?.update(
        telem,
        {
          openness: isRoofOpen || isConvertibleOpen() ? 1 : 0,
          // The cabin IR is per-vehicle, so the audio follows the vehicle
          // picker the same way the interior does.
          vehicle: getCurrentVehicleType(),
        },
        readCabinEnvironment(cabinWeatherRef.current),
      );

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

      rafId = requestFrame(animate);
    };

    // The window's rAF, or the WebXR session's while it presents (#331).
    rafId = requestFrame(animate);
    return () => {
      active = false;
      cancelFrame(rafId);
    };
  }, [nightIntensity, headlightsOn, domeLightOn, controlMode, isRoofOpen, gearRef]);

  // A UI_INTERACT click on the centre display is handled by `handleDisplayClick`;
  // it must not also grab the pointer.
  const isDashboardControlAtPoint = useCallback((x: number, y: number): boolean => {
    return isCarCenterDisplayHit(x, y);
  }, []);

  const handleDisplayMouseDown = useCallback((e: React.MouseEvent) => {
    displayPressRef.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }, []);

  const handleDisplayClick = useCallback((e: React.MouseEvent) => {
    const press = displayPressRef.current;
    displayPressRef.current = null;
    // Locked modes have no cursor: a click there is driving, not a display tap.
    if (!press || controlMode !== 'UI_INTERACT') return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > 6) return;
    if (isCarCenterDisplayHit(e.clientX, e.clientY)) {
      cycleCarDisplayPage();
    }
  }, [controlMode]);

  const handleThrust = useCallback((direction: 'forward' | 'backward') => {
    if (gearHopCount(gearRef.current) === 0) return;
    dynamicsRef.current?.noteThrust(direction);
    triggerCarInteriorPress(direction === 'forward' ? 'gasPedal' : 'brakePedal');
  }, [gearRef]);

  const handleSteeringDelta = useCallback((delta: number) => {
    steeringInputRef.current = Math.max(-90, Math.min(90, steeringInputRef.current + delta));
  }, []);

  return {
    telemetry,
    steeringInputRef,
    isDashboardControlAtPoint,
    handleDisplayMouseDown,
    handleDisplayClick,
    handleThrust,
    handleSteeringDelta,
  };
}
