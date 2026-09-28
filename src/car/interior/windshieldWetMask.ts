import * as THREE from 'three';
import { WIPER_BAND_HALF_WIDTH, wiperBladeAngle } from './windshieldWiperGeometry';

/**
 * The windshield's **wet mask**: how wet the glass still is along each wiper
 * blade's sweep, persisted between frames.
 *
 * A wiper does not clear a thin sector that moves — it clears everything it has
 * passed, and the glass then re-wets. The decal fallback
 * (`WindowWeatherOverlay`'s TSL/GLSL material) is stateless, so it can only
 * show the sector under the blade *right now*. The portal keeps this mask
 * instead, which makes the swept strip stay visibly clean behind the blade and
 * fade back to droplets afterwards.
 *
 * ### Why a 1-D profile, not a 2-D texture
 *
 * A blade is a rigid line about a fixed pivot, so what it wipes is a function of
 * *angle from the pivot* only (the radial extent is a fixed gate in the shader,
 * `WIPER_RADIAL_START..END`). One row of `WET_MASK_BINS` angle bins per blade is
 * the whole state: 128×2 bytes, updated on the CPU, sampled by the portal shader
 * with hardware linear filtering. It also means dwell (intermittent mode) and
 * "wipers switched off" re-wet the glass correctly with no special case —
 * regrowth is driven by real time, not by the wiper phase.
 *
 * ### Phase is an input, not state
 *
 * `phase` is `CarInteriorAnimator`'s `wiperAnimationTime % 1` — the same
 * number that swings the blade meshes — so the wiped strip cannot desync from
 * the blades. Blade angle is `wiperBladeAngle(phase)`; the right blade sweeps
 * the mirror angle.
 */

/** Angle bins per blade row. */
export const WET_MASK_BINS = 128;

/**
 * Angle domain the bins cover, radians in the overlay's atan space. Wider than
 * the sweep (`±WIPER_SWEEP_GAIN` plus the band) so the outermost bins are never
 * wiped and clamp-to-edge sampling reads "fully wet" past the ends.
 */
export const WET_MASK_THETA_MIN = -1.2;
export const WET_MASK_THETA_MAX = 1.2;

/** Texture rows. */
export const WET_MASK_ROW_LEFT = 0;
export const WET_MASK_ROW_RIGHT = 1;

/** Seconds for a fully wiped strip to re-wet, on near-dry glass and in heavy rain. */
export const WET_REGROW_DRY_SECONDS = 18;
export const WET_REGROW_RAIN_SECONDS = 3;

const THETA_SPAN = WET_MASK_THETA_MAX - WET_MASK_THETA_MIN;

/** Centre angle of bin `i`. */
export function wetMaskBinTheta(i: number): number {
    return WET_MASK_THETA_MIN + ((i + 0.5) / WET_MASK_BINS) * THETA_SPAN;
}

/** Texture u for an angle — the shader does exactly this before sampling. */
export function wetMaskThetaToU(theta: number): number {
    return (theta - WET_MASK_THETA_MIN) / THETA_SPAN;
}

function smoothstep01(x: number): number {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
}

export interface WetMaskWiping {
    active: boolean;
    /** 0..1 sweep phase from the animator. */
    phase: number;
}

export class WindshieldWetMask {
    /** `WET_MASK_BINS`×2, R8. 255 = fully wet, 0 = just wiped. Row 0 left blade, row 1 right. */
    readonly texture: THREE.DataTexture;

    private readonly wet = new Float32Array(WET_MASK_BINS * 2).fill(1);
    private readonly bytes = new Uint8Array(WET_MASK_BINS * 2).fill(255);
    /** Left-blade angle last frame; null while the wipers are off so a new stroke starts from a point. */
    private prevAngle: number | null = null;

    constructor() {
        this.texture = new THREE.DataTexture(
            this.bytes,
            WET_MASK_BINS,
            2,
            THREE.RedFormat,
            THREE.UnsignedByteType,
        );
        this.texture.name = 'windshieldWetMask';
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.wrapS = THREE.ClampToEdgeWrapping;
        this.texture.wrapT = THREE.ClampToEdgeWrapping;
        this.texture.generateMipmaps = false;
        this.texture.flipY = false;
        this.texture.colorSpace = THREE.NoColorSpace;
        this.texture.needsUpdate = true;
    }

    /**
     * Advance one frame. `rainNorm` (0..1) only sets how fast the glass re-wets.
     * Returns whether the GPU copy changed, so callers/tests can see idle frames
     * are free.
     */
    update(deltaSeconds: number, wiping: WetMaskWiping, rainNorm: number): boolean {
        const dt = Math.max(0, deltaSeconds);
        const rain = Math.min(1, Math.max(0, rainNorm));
        const regrowSeconds =
            WET_REGROW_DRY_SECONDS + (WET_REGROW_RAIN_SECONDS - WET_REGROW_DRY_SECONDS) * rain;
        const regrow = dt / regrowSeconds;

        if (regrow > 0) {
            for (let i = 0; i < this.wet.length; i++) {
                const w = this.wet[i]!;
                if (w < 1) this.wet[i] = Math.min(1, w + regrow);
            }
        }

        if (wiping.active) {
            const angle = wiperBladeAngle(wiping.phase);
            const from = this.prevAngle ?? angle;
            // The blade may have moved a long way since the last update (a
            // hitched frame). Wipe the whole interval it crossed, not just the
            // spot it landed on, so a dropped frame cannot leave a dry-looking gap.
            this.wipeRow(WET_MASK_ROW_LEFT, Math.min(from, angle), Math.max(from, angle));
            this.wipeRow(WET_MASK_ROW_RIGHT, Math.min(-from, -angle), Math.max(-from, -angle));
            this.prevAngle = angle;
        } else {
            this.prevAngle = null;
        }

        return this.uploadIfChanged();
    }

    /** Wetness (0 = wiped, 1 = wet) along a blade's sweep, linearly filtered like the GPU does. */
    sample(row: number, theta: number): number {
        const x = Math.min(WET_MASK_BINS - 1, Math.max(0, wetMaskThetaToU(theta) * WET_MASK_BINS - 0.5));
        const i0 = Math.floor(x);
        const i1 = Math.min(WET_MASK_BINS - 1, i0 + 1);
        const f = x - i0;
        const base = row * WET_MASK_BINS;
        return this.wet[base + i0]! * (1 - f) + this.wet[base + i1]! * f;
    }

    /** Drop all wiping (glass fully wet again). */
    reset(): void {
        this.wet.fill(1);
        this.prevAngle = null;
        this.uploadIfChanged();
    }

    dispose(): void {
        this.texture.dispose();
    }

    private wipeRow(row: number, lo: number, hi: number): void {
        const base = row * WET_MASK_BINS;
        for (let i = 0; i < WET_MASK_BINS; i++) {
            const theta = wetMaskBinTheta(i);
            const dist = theta < lo ? lo - theta : theta > hi ? theta - hi : 0;
            // 0 inside the swept interval, easing to 1 at one band-width away.
            const cap = smoothstep01(dist / WIPER_BAND_HALF_WIDTH);
            if (cap < this.wet[base + i]!) this.wet[base + i] = cap;
        }
    }

    private uploadIfChanged(): boolean {
        let changed = false;
        for (let i = 0; i < this.wet.length; i++) {
            const b = Math.round(this.wet[i]! * 255);
            if (this.bytes[i] !== b) {
                this.bytes[i] = b;
                changed = true;
            }
        }
        if (changed) this.texture.needsUpdate = true;
        return changed;
    }
}
