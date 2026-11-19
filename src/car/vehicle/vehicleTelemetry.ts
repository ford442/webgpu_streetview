/**
 * What the car is doing, decoded from the vehicle model's telemetry block
 * (`veh_telemetry`, cpp/src/vehicle_module.cpp, layout in abi.h) — and the
 * external store it is published through.
 *
 * Per-frame data: it lives in a store, never in React context or a provider
 * value (`AppShell.renders.test.tsx`). The car loop (`useCarDashboardBridge`)
 * writes it once per display frame; per-frame readers call
 * `vehicleTelemetryStore.get()`, the HUD subscribes rate-limited
 * (`useVehicleTelemetry`), and `window.__VEHICLE__` mirrors it for e2e specs
 * and the console.
 */
import { useEffect, useState } from 'react';
import { createStore } from '../../state';

export interface VehicleTelemetry {
    /** |speed|, km/h. */
    speedKmh: number;
    /** Engine rpm. */
    rpm: number;
    /** Gear indicator: P, N, R, 1–3, D (4th and up read D, as on a real cluster). */
    gear: string;
    /** The engine is pulling the car faster (throttle open and the car gaining speed). */
    accelerating: boolean;
    /** Engine load 0–1: the throttle the engine actually runs (idle governor included, 0 on fuel cut). */
    load: number;
    /** Signed speed, m/s (+ forward). */
    speedMps: number;
    /** Gearbox gear: −1 reverse, 0 decoupled (P/N), 1…n. */
    gearIndex: number;
    /** Effective throttle / brake, 0–1 (after the pedal lags). */
    throttle: number;
    brake: number;
    /** Longitudinal / lateral acceleration, m/s². */
    accelMps2: number;
    latAccelMps2: number;
    /** Body pitch (rad, + nose up), heave (m) and roll (rad, + right side down) — car-local. */
    pitchRad: number;
    heaveM: number;
    rollRad: number;
    /** A gear change is running (torque interruption). */
    shifting: boolean;
    /** Gear changes since the sim was created — an event counter (haptics, sound). */
    shiftCount: number;
    /** The converter's lockup clutch is closed. */
    lockup: boolean;
    redlineRpm: number;
}

/** Telemetry block indices (abi.h, `sw_veh_telemetry`). */
const T = {
    speedMps: 0, speedKmh: 1, rpm: 2, gear: 3, selector: 4, throttle: 5, brake: 6, load: 7,
    accel: 8, latAccel: 9, pitch: 10, heave: 11, roll: 12, shifting: 14, shiftCount: 15,
    lockup: 16, redline: 23,
} as const;

/** Selector codes the model takes (abi.h): 0 P, 1 R, 2 N, 3 D. */
export const SELECTOR = { P: 0, R: 1, N: 2, D: 3 } as const;

/** A parked, idling sedan: what the gauges show before the first frame. */
export const PARKED_TELEMETRY: Readonly<VehicleTelemetry> = Object.freeze({
    speedKmh: 0,
    rpm: 800,
    gear: 'P',
    accelerating: false,
    load: 0,
    speedMps: 0,
    gearIndex: 0,
    throttle: 0,
    brake: 1,
    accelMps2: 0,
    latAccelMps2: 0,
    pitchRad: 0,
    heaveM: 0,
    rollRad: 0,
    shifting: false,
    shiftCount: 0,
    lockup: false,
    redlineRpm: 6500,
});

/**
 * The cluster's gear letter. A car at rest with nowhere to go reads P (the
 * cabin shifter shows the driver's selection; `CarModeView` decides which).
 */
function gearLabel(selector: number, gearIndex: number, speedKmh: number, targetKmh: number): string {
    if (selector === SELECTOR.P) return 'P';
    if (selector === SELECTOR.R || gearIndex < 0) return 'R';
    if (selector === SELECTOR.N) return 'N';
    if (speedKmh < 0.5 && targetKmh < 0.5) return 'P';
    if (gearIndex >= 1 && gearIndex <= 3) return String(gearIndex);
    return 'D';
}

/** Decode a `veh_telemetry` block. `targetKmh` is the driver's current target (for the P read-out at rest). */
export function decodeTelemetry(block: Float64Array, targetKmh: number): VehicleTelemetry {
    const at = (i: number): number => block[i] ?? 0;
    const speedKmh = at(T.speedKmh);
    const gearIndex = at(T.gear);
    const throttle = at(T.throttle);
    const accelMps2 = at(T.accel);
    const speedMps = at(T.speedMps);
    return {
        speedKmh,
        rpm: at(T.rpm),
        gear: gearLabel(at(T.selector), gearIndex, speedKmh, targetKmh),
        // Gaining speed in the direction of travel under throttle.
        accelerating: throttle > 0.15 && accelMps2 * (speedMps < 0 ? -1 : 1) > 0.3,
        load: at(T.load),
        speedMps,
        gearIndex,
        throttle,
        brake: at(T.brake),
        accelMps2,
        latAccelMps2: at(T.latAccel),
        pitchRad: at(T.pitch),
        heaveM: at(T.heave),
        rollRad: at(T.roll),
        shifting: at(T.shifting) !== 0,
        shiftCount: at(T.shiftCount),
        lockup: at(T.lockup) !== 0,
        redlineRpm: at(T.redline),
    };
}

export const vehicleTelemetryStore = createStore<VehicleTelemetry>(PARKED_TELEMETRY);

vehicleTelemetryStore.subscribe(() => {
    if (typeof window !== 'undefined') window.__VEHICLE__ = vehicleTelemetryStore.get();
});

/**
 * The latest telemetry for a component, at most every `intervalMs` (a
 * gauge read-out does not need 60 Hz; the 3D cluster reads per frame).
 */
export function useVehicleTelemetry(intervalMs = 150): VehicleTelemetry {
    const [telemetry, setTelemetry] = useState(() => vehicleTelemetryStore.get());
    useEffect(() => {
        let last = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
            timer = null;
            last = performance.now();
            setTelemetry(vehicleTelemetryStore.get());
        };
        const unsubscribe = vehicleTelemetryStore.subscribe(() => {
            if (timer !== null) return;
            const wait = intervalMs - (performance.now() - last);
            if (wait <= 0) flush();
            else timer = setTimeout(flush, wait);
        });
        return () => {
            unsubscribe();
            if (timer !== null) clearTimeout(timer);
        };
    }, [intervalMs]);
    return telemetry;
}

declare global {
    interface Window {
        /** The vehicle model's latest telemetry (`car/vehicle/vehicleTelemetry.ts`). */
        __VEHICLE__?: VehicleTelemetry;
    }
}
