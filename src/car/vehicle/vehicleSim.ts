/**
 * The car loop's handle on the vehicle model (cpp/src/vehicle_module.cpp).
 *
 * The model is the only implementation of the physics — engine, converter,
 * gearbox, brakes, body springs — and it runs in WASM (`requireWasm()`).
 * This class owns what is the caller's by contract:
 *
 *   - the fixed-step accumulator: the model steps at 120 Hz whatever the
 *     display rate, so a 30 Hz tab and a 144 Hz one drive the same car;
 *   - the blocks (params per variant, the opaque state, the inputs);
 *   - the *target speed*. Street View movement is discrete, so what the
 *     hop/cruise layer knows is that the car is hopping, how far and how
 *     often. A sustained run of hops (cruise, a held W) holds a target; it
 *     bleeds off once the hops stop. The model's own driver turns the target
 *     into throttle and brake — speed, rpm, gear, load and body motion are
 *     all the model's.
 *
 * It makes no Maps calls and owns no hop cadence (cruise/route code and
 * `services/maps/callBudget.ts` do).
 */
import { requireWasm } from '../../wasm';
import type { VehicleType } from '../VehicleManager';
import { SELECTOR, decodeTelemetry, type VehicleTelemetry } from './vehicleTelemetry';

/** The model's fixed step (s). */
export const VEHICLE_STEP_S = 1 / 120;
/** Longest frame the accumulator integrates (s): a backgrounded tab does not fast-forward minutes. */
const MAX_FRAME_S = 0.25;

/** Road roughness (0–1) until a road class drives it: ordinary asphalt. */
const DEFAULT_ROAD_ROUGHNESS = 0.3;

// Target-speed inference from hops (km/h), the hop/cruise side of the contract.
const MAX_HOP_TARGET_KMH = 96;
/** The target starts bleeding off this long after the last movement input (s). */
const COAST_DELAY_S = 2.4;
const COAST_KMH_PER_S = 9;

/** Model variant per vehicle (abi.h `sw_veh_params`: 0 sedan, 1 sports, 2 limousine, 3 van). */
const VARIANT: Record<VehicleType, number> = {
    sedan: 0,
    convertible: 1,
    cortianics: 1,
    limousine: 2,
    'science-lab': 3,
};

export function vehicleVariant(type: VehicleType | null | undefined): number {
    return (type && VARIANT[type]) ?? 0;
}

/** Inputs block indices (abi.h). */
const IN = { mode: 0, target: 1, throttle: 2, brake: 3, selector: 4, yaw: 5, roughness: 6, grade: 7 } as const;

const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

export class VehicleSim {
    private variant: number;
    private params: Float64Array;
    private state: Float64Array;
    private readonly inputs = new Float64Array(8);
    private readonly telemetryBlock = new Float64Array(24);
    private accumulator = 0;

    private targetKmh = 0;
    private sinceMove = Infinity;
    private reversing = false;
    /** Driver-selected cabin gear (P/R/N/D/2/3). */
    private selectedGear = 'D';

    private lastHeadingDeg: number | null = null;
    private yawRate = 0;

    constructor(vehicle: VehicleType | null = null, seed = 1) {
        this.variant = vehicleVariant(vehicle);
        const wasm = requireWasm();
        this.params = wasm.vehicleParams(this.variant);
        this.state = wasm.vehicleReset(this.params, 0, SELECTOR.D, seed);
        this.inputs[IN.roughness] = DEFAULT_ROAD_ROUGHNESS;
    }

    /**
     * Follow the vehicle picker. A new variant keeps the car's speed (the
     * state restarts at it in the gear the new gearbox would hold).
     */
    public setVehicle(vehicle: VehicleType | null): void {
        const variant = vehicleVariant(vehicle);
        if (variant === this.variant) return;
        const wasm = requireWasm();
        const speed = Math.abs(this.state[0] ?? 0);
        this.variant = variant;
        this.params = wasm.vehicleParams(variant);
        this.state = wasm.vehicleReset(this.params, speed, this.selector(), 1);
    }

    /**
     * A panorama hop of `distanceMeters`. Repeated hops (cruise, held W)
     * sustain the target; a lone one gives a short surge.
     */
    public notePanoHop(distanceMeters: number): void {
        if (!(distanceMeters > 0) || distanceMeters > 300) return;
        // A typical hop is ~10 m every ~1.5 s in cruise → reads as ~25–40 km/h.
        const estimate = Math.min(MAX_HOP_TARGET_KMH, 14 + distanceMeters * 2.2);
        this.targetKmh = Math.max(this.targetKmh, estimate);
        this.reversing = false;
        this.sinceMove = 0;
    }

    /** A W/S thrust input. */
    public noteThrust(direction: 'forward' | 'backward'): void {
        if (direction === 'forward') {
            this.targetKmh = Math.max(this.targetKmh, 30);
            this.reversing = false;
        } else {
            this.targetKmh = Math.max(this.targetKmh, 12);
            this.reversing = Math.abs(this.state[0] ?? 0) * 3.6 < 20;
        }
        this.sinceMove = 0;
    }

    /** Sync the cabin shifter: P/N stop the target, R reverses, 2/3 queue denser hops (a higher target). */
    public noteGear(gear: string): void {
        this.selectedGear = gear;
        if (gear === 'P' || gear === 'N') {
            this.targetKmh = 0;
            this.reversing = false;
        } else if (gear === 'R') {
            this.reversing = true;
        } else {
            this.reversing = false;
            const hopBoost = gear === '3' ? 22 : gear === '2' ? 12 : 0;
            if (hopBoost > 0 && this.sinceMove < COAST_DELAY_S) {
                this.targetKmh = Math.max(this.targetKmh, 28 + hopBoost);
            }
        }
    }

    /**
     * The car body's heading (deg, compass: + clockwise) this frame — the
     * model's yaw rate (+ left) comes from its change. A pano hop can snap
     * the heading; the rate is clamped and eased so a snap is not a skid.
     */
    public noteHeading(carHeadingDeg: number, dt: number): void {
        if (!Number.isFinite(carHeadingDeg)) return;
        if (this.lastHeadingDeg !== null && dt > 0) {
            const raw = (-wrap180(carHeadingDeg - this.lastHeadingDeg) * Math.PI) / 180 / dt;
            const clamped = Math.max(-1.5, Math.min(1.5, raw));
            this.yawRate += (clamped - this.yawRate) * Math.min(1, dt / 0.25);
        }
        this.lastHeadingDeg = carHeadingDeg;
    }

    /** Kill the target (e.g. entering free-look); the model's driver brakes to a stop. */
    public stop(): void {
        this.targetKmh = 0;
        this.reversing = false;
    }

    private selector(): number {
        if (this.selectedGear === 'P') return SELECTOR.P;
        if (this.selectedGear === 'N') return SELECTOR.N;
        if (this.selectedGear === 'R' || this.reversing) return SELECTOR.R;
        return SELECTOR.D;
    }

    /** Advance by a display frame of `dt` seconds and return the telemetry. */
    public update(dt: number): VehicleTelemetry {
        const frame = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), MAX_FRAME_S) : 0;

        this.sinceMove += frame;
        if (this.selectedGear === 'P' || this.selectedGear === 'N') {
            this.targetKmh = 0;
        } else if (this.sinceMove > COAST_DELAY_S) {
            this.targetKmh = Math.max(0, this.targetKmh - COAST_KMH_PER_S * frame);
        }

        this.inputs[IN.mode] = 0;
        this.inputs[IN.target] = this.targetKmh / 3.6;
        this.inputs[IN.selector] = this.selector();
        this.inputs[IN.yaw] = this.yawRate;

        this.accumulator += frame;
        const steps = Math.floor(this.accumulator / VEHICLE_STEP_S);
        const wasm = requireWasm();
        if (steps > 0) {
            this.accumulator -= steps * VEHICLE_STEP_S;
            wasm.vehicleStep(this.params, this.state, this.inputs, VEHICLE_STEP_S, steps);
        }
        wasm.vehicleTelemetry(this.params, this.state, this.telemetryBlock);
        return decodeTelemetry(this.telemetryBlock, this.targetKmh);
    }
}
