/**
 * Fixture page for e2e/atmosphere.spec.ts.
 *
 * Builds the production `AtmosphereController` on the real device, reads every
 * LUT back (rgba16float → f32), and reports on `window.__out`:
 *
 * - `transmittance`: max |GPU − C++| against `atmoTransmittanceLut` (the same
 *   texels, the committed wasm) at two visibilities;
 * - `builds`: the rebuild counts for a still sun, a 0.05° move and a 1° move;
 * - `sky`: sky-view luminance (Rec.709 Y) at the zenith and along the
 *   horizon toward / away from the sun, for the sunset looks (2°, −4°, −12°);
 * - `earthShadow`: the anti-solar sky at 2° and 8° elevation, in clear air
 *   (100 km) with the sun 2° down — the shadow band and the Belt of Venus;
 * - `aerial`: 1 − transmittance at 300 m toward the horizon at 5 km and 50 km
 *   visibility, and whether the volume darkens monotonically with distance;
 * - `uncaptured`: any validation error the device raised.
 */
import { loadWasmModule } from '/src/wasm';
import { AtmosphereController } from '/src/renderer/atmosphere/AtmosphereController';
import { ATMOSPHERE_AERIAL_MAX_KM, ATMOSPHERE_LUT_SIZES } from '/src/renderer/atmosphere/atmosphereLayout';
import { createAtmosphereOptions, type AtmosphereOptions } from '/src/renderer/atmosphere/atmosphereOptions';

interface Out {
    done?: boolean;
    fatal?: string;
    adapter?: string;
    transmittance?: Record<string, { maxAbsDiff: number; at: [number, number, number]; gpu: number; cpu: number }>;
    builds?: { still: { medium: number; sun: number }; small: { medium: number; sun: number }; moved: { medium: number; sun: number } };
    sky?: Record<string, { zenith: number; horizonSun: number; horizonAway: number; finite: boolean; min: number }>;
    earthShadow?: { band: [number, number, number]; belt: [number, number, number] };
    aerial?: Record<string, { haze300m: number; monotonic: boolean }>;
    uncaptured?: string[];
}

const out: Out = {};
(window as unknown as { __out: Out }).__out = out;
const deg = (d: number) => (d * Math.PI) / 180;

function half(bits: number): number {
    const s = bits & 0x8000 ? -1 : 1;
    const e = (bits >> 10) & 0x1f;
    const f = bits & 0x3ff;
    if (e === 0) return s * f * 2 ** -24;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * (1 + f / 1024) * 2 ** (e - 15);
}

async function readback(device: GPUDevice, texture: GPUTexture, w: number, h: number, d = 1): Promise<Float32Array> {
    const bytesPerRow = Math.ceil((w * 8) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d });
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint16Array(buffer.getMappedRange());
    const result = new Float32Array(w * h * d * 4);
    for (let z = 0; z < d; z++) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w * 4; x++) {
                result[((z * h + y) * w) * 4 + x] = half(raw[((z * h + y) * bytesPerRow) / 2 + x]!);
            }
        }
    }
    buffer.unmap();
    buffer.destroy();
    return result;
}

const luma = (px: Float32Array, i: number) => 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;

async function run(): Promise<void> {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    out.adapter = adapter.info?.description || adapter.info?.vendor || 'unknown';
    const device = await adapter.requestDevice();
    const uncaptured: string[] = [];
    device.addEventListener('uncapturederror', (e) => uncaptured.push((e as GPUUncapturedErrorEvent).error.message));
    const wasm = await loadWasmModule();

    const controller = new AtmosphereController({ device });
    await controller.pass.init();
    const luts = controller.getLuts()!;
    const options = (patch: Partial<AtmosphereOptions>): AtmosphereOptions =>
        ({ ...createAtmosphereOptions(), enabled: true, sunAltitude: deg(2), ...patch });
    /** One frame of the pass: encode only if it asks to. */
    const frame = async (o: AtmosphereOptions) => {
        controller.setOptions(o);
        const encoder = device.createCommandEncoder();
        if (controller.pass.enabled()) controller.pass.encode(encoder);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
    };

    // --- transmittance vs the C++ reference --------------------------------
    const [tw, th] = ATMOSPHERE_LUT_SIZES.transmittance;
    out.transmittance = {};
    for (const visibilityM of [null, 5000] as const) {
        await frame(options({ visibilityM }));
        const gpu = await readback(device, luts.transmittance, tw, th);
        const cpu = wasm.atmoTransmittanceLut(wasm.atmoParams(visibilityM, 0.3), tw, th);
        let worst = { maxAbsDiff: 0, at: [0, 0, 0] as [number, number, number], gpu: 0, cpu: 0 };
        for (let i = 0; i < tw * th; i++) {
            for (let c = 0; c < 3; c++) {
                const diff = Math.abs(gpu[i * 4 + c]! - cpu[i * 4 + c]!);
                if (!(diff <= worst.maxAbsDiff)) {
                    worst = { maxAbsDiff: diff, at: [i % tw, Math.floor(i / tw), c], gpu: gpu[i * 4 + c]!, cpu: cpu[i * 4 + c]! };
                }
            }
        }
        out.transmittance[visibilityM === null ? 'default' : `${visibilityM}m`] = worst;
    }

    // --- on change, not per frame -------------------------------------------
    await frame(options({}));
    const base = { ...controller.getBuildCounts() };
    await frame(options({}));
    await frame(options({}));
    const still = { ...controller.getBuildCounts() };
    await frame(options({ sunAltitude: deg(2.05) }));
    const small = { ...controller.getBuildCounts() };
    await frame(options({ sunAltitude: deg(3) }));
    const moved = { ...controller.getBuildCounts() };
    const delta = (c: { medium: number; sun: number }) => ({ medium: c.medium - base.medium, sun: c.sun - base.sun });
    out.builds = { still: delta(still), small: delta(small), moved: delta(moved) };

    // --- sky view at the sunset looks ---------------------------------------
    const [sw, sh] = ATMOSPHERE_LUT_SIZES.skyview;
    // Inverse of skyview_lut's v mapping above the horizon. The observer is
    // 10 m up, so the geometric horizon is 0.1° below 90°: close enough here.
    const zenithHorizon = Math.PI / 2;
    const rowFor = (elevationDeg: number) => {
        const z = Math.PI / 2 - deg(elevationDeg);
        const v = (1 - Math.sqrt(Math.max(0, 1 - z / zenithHorizon))) / 2;
        return Math.min(sh - 1, Math.max(0, Math.floor(v * sh)));
    };
    const colFor = (azimuthDeg: number) => {
        const u = Math.sqrt((1 - Math.cos(deg(azimuthDeg))) / 2);
        return Math.min(sw - 1, Math.max(0, Math.floor(u * sw)));
    };
    out.sky = {};
    for (const sunDeg of [2, -4, -12]) {
        await frame(options({ sunAltitude: deg(sunDeg) }));
        const px = await readback(device, luts.skyview, sw, sh);
        const at = (el: number, az: number) => luma(px, (rowFor(el) * sw + colFor(az)) * 4);
        let finite = true;
        let min = Infinity;
        for (let i = 0; i < sw * sh * 4; i++) {
            if (!Number.isFinite(px[i]!)) finite = false;
            min = Math.min(min, px[i]!);
        }
        out.sky[`${sunDeg}`] = {
            zenith: at(89.9, 90),
            horizonSun: at(0.5, 0),
            horizonAway: at(0.5, 180),
            finite,
            min,
        };
    }

    {
        await frame(options({ visibilityM: 100_000, sunAltitude: deg(-2) }));
        const px = await readback(device, luts.skyview, sw, sh);
        const rgb = (el: number): [number, number, number] => {
            const i = (rowFor(el) * sw + colFor(180)) * 4;
            return [px[i]!, px[i + 1]!, px[i + 2]!];
        };
        out.earthShadow = { band: rgb(2), belt: rgb(8) };
    }

    // --- aerial perspective at 300 m ----------------------------------------
    const [aw, ah, ad] = ATMOSPHERE_LUT_SIZES.aerial;
    out.aerial = {};
    for (const visibilityM of [5000, 50000]) {
        await frame(options({ visibilityM, sunAltitude: deg(30) }));
        const px = await readback(device, luts.aerial, aw, ah, ad);
        // Looking along the horizon (elevation ~+3°), 90° from the sun.
        const col = Math.floor(0.5 * aw);
        const row = Math.floor((deg(3) / Math.PI + 0.5) * ah);
        const alpha = (k: number) => px[((k * ah + row) * aw + col) * 4 + 3]!;
        let monotonic = true;
        for (let k = 1; k < ad; k++) if (alpha(k) > alpha(k - 1) + 1e-3) monotonic = false;
        // Slice centre k ↔ d = max · ((k + 0.5) / n)²: interpolate at 0.3 km.
        const kf = Math.sqrt(0.3 / ATMOSPHERE_AERIAL_MAX_KM) * ad - 0.5;
        const k0 = Math.floor(kf);
        const t = kf - k0;
        const transmittance = alpha(k0) * (1 - t) + alpha(k0 + 1) * t;
        out.aerial[`${visibilityM}m`] = { haze300m: 1 - transmittance, monotonic };
    }

    controller.dispose();
    await device.queue.onSubmittedWorkDone();
    out.uncaptured = uncaptured;
}

run()
    .catch((error: unknown) => {
        out.fatal = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    })
    .finally(() => {
        out.done = true;
    });
