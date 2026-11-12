/**
 * The atmosphere pass's GPU layout: LUT sizes and formats, the 128-byte
 * `AtmosphereParams` uniform block (`public/shaders/atmosphere.wgsl`) and the
 * bind-group binding numbers. `atmosphereLayout.test.ts` checks the struct in
 * the WGSL against these indices.
 *
 * Floats 0–23 are the C++ params block verbatim (`sw_atmo_params`, abi.h):
 * the GPU and the CPU reference integrate the same medium.
 *
 * ## LUT texel mappings (what slice-2 samplers invert)
 *
 * All four tables are in the **sun's frame** — z up, the sun in the x-z
 * plane — so they depend on the sun's elevation and the medium only. The
 * camera turning never rebuilds them.
 *
 * - **transmittance** (256×64): texel (i, j) is Bruneton's x_mu = i/(w−1),
 *   x_r = j/(h−1); row 0 is the ground. Sample at
 *   `0.5/n + x·(1 − 1/n)` (`transmittanceUv` in the WGSL).
 * - **multi-scattering** (32×32): u = μ_s·0.5 + 0.5, v = (r − R_g)/(R_t − R_g).
 * - **sky view** (192×108): u = √((1 − cos φ)/2) for azimuth φ from the sun;
 *   v squeezes the zenith angle toward the horizon from both sides (Hillaire
 *   §5.3, `skyview_lut`).
 * - **aerial perspective** (32×32×32): u = φ/π, v = elevation/π + 0.5,
 *   w = √(d / {@link ATMOSPHERE_AERIAL_MAX_KM}); rgb = in-scattered
 *   luminance, a = mean transmittance. Hillaire's froxels are camera-aligned;
 *   with the observer fixed at the pano, sun-relative axes give the same
 *   integral without a per-frame rebuild.
 */

export const ATMOSPHERE_LUT_FORMAT: GPUTextureFormat = 'rgba16float';

export const ATMOSPHERE_LUT_SIZES = {
    transmittance: [256, 64],
    multiscatter: [32, 32],
    skyview: [192, 108],
    aerial: [32, 32, 32],
} as const;

/** Aerial-perspective volume depth range, km (slice w = √(d / max)). */
export const ATMOSPHERE_AERIAL_MAX_KM = 32;

/** `@workgroup_size(8, 8, 1)` for every entry point. */
export const ATMOSPHERE_WORKGROUP = 8;

/** Floats in `AtmosphereParams` (8 × vec4). */
export const ATMOSPHERE_UNIFORM_FLOAT_COUNT = 32;

/** Floats the C++ params block occupies at the start of the uniform block. */
export const ATMOSPHERE_MEDIUM_FLOAT_COUNT = 24;

export const AtmosphereUniformIndex = {
    bottomRadiusKm: 0,
    topRadiusKm: 1,
    rayleighScaleHeightKm: 2,
    mieScaleHeightKm: 3,
    rayleighScattering: 4,
    mieG: 7,
    mieScattering: 8,
    ozoneCenterKm: 11,
    mieExtinction: 12,
    ozoneHalfWidthKm: 15,
    ozoneAbsorption: 16,
    visibilityKm: 19,
    groundAlbedo: 20,
    turbidity: 23,
    sinSunElevation: 24,
    cosSunElevation: 25,
    sunIlluminance: 26,
    observerAltitudeKm: 28,
    aerialMaxKm: 29,
} as const;

/** Binding numbers in group 0 of `atmosphere.wgsl`; each pipeline's layout takes the ones it uses. */
export const AtmosphereBinding = {
    params: 0,
    sampler: 1,
    transmittance: 2,
    multiscatter: 3,
    transmittanceOut: 4,
    multiscatterOut: 5,
    skyviewOut: 6,
    aerialOut: 7,
} as const;
