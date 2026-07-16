/**
 * visualPresets.ts - Quality preset configuration for the WebGPU rendering pipeline
 *
 * Defines visual quality levels (low, medium, high, ultra) controlling texture resolution,
 * shadow quality, post-processing effects, animation quality, and lighting complexity.
 */

// ============================================================
// Types
// ============================================================

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface VisualPreset {
  name: string;
  quality: QualityLevel;

  // Texture settings
  textureResolution: number;
  anisotropy: number;

  // Shadow settings
  shadowMapSize: number;
  shadowsEnabled: boolean;
  softShadows: boolean;

  // Post-processing
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  vignetteEnabled: boolean;
  vignetteStrength: number;
  filmGrainEnabled: boolean;
  filmGrainIntensity: number;
  chromaticAberrationEnabled: boolean;
  chromaticAberrationStrength: number;
  depthOfFieldEnabled: boolean;
  motionBlurEnabled: boolean;

  /**
   * WebGPU weather post-process pipeline: 'fragment' (default, streetview.wgsl
   * -> weather-post.wgsl) or 'compute' (weather-post-compute.wgsl, storage-buffer
   * based — see docs/RENDERER_FALLBACK.md and ComputeWeatherPostProcessor.ts).
   * A `?weather=compute`/`?weather=fragment` URL flag or persisted
   * localStorage choice always overrides this default. Ignored by the
   * WebGL2 fallback renderer, which is fragment-only.
   */
  weatherPostProcessMode: 'fragment' | 'compute';

  // Lighting
  maxLights: number;
  ambientOcclusion: boolean;
  environmentMapResolution: number;

  // Animation
  particleCount: number;
  physicsEnabled: boolean;

  // Performance
  targetFPS: number;
  pixelRatio: number;
  antialias: boolean;
}

// ============================================================
// Preset Definitions
// ============================================================

export const PRESETS: Record<QualityLevel, VisualPreset> = {
  low: {
    name: 'Low',
    quality: 'low',
    weatherPostProcessMode: 'fragment',

    textureResolution: 64,
    anisotropy: 1,

    shadowMapSize: 512,
    shadowsEnabled: false,
    softShadows: false,

    bloomEnabled: false,
    bloomStrength: 0,
    bloomRadius: 0,
    bloomThreshold: 1.0,
    vignetteEnabled: false,
    vignetteStrength: 0,
    filmGrainEnabled: false,
    filmGrainIntensity: 0,
    chromaticAberrationEnabled: false,
    chromaticAberrationStrength: 0,
    depthOfFieldEnabled: false,
    motionBlurEnabled: false,

    maxLights: 2,
    ambientOcclusion: false,
    environmentMapResolution: 64,

    particleCount: 100,
    physicsEnabled: false,

    targetFPS: 30,
    pixelRatio: 0.75,
    antialias: false,
  },

  medium: {
    name: 'Medium',
    quality: 'medium',
    weatherPostProcessMode: 'fragment',

    textureResolution: 128,
    anisotropy: 4,

    shadowMapSize: 1024,
    shadowsEnabled: true,
    softShadows: false,

    bloomEnabled: true,
    bloomStrength: 0.3,
    bloomRadius: 0.4,
    bloomThreshold: 0.85,
    vignetteEnabled: true,
    vignetteStrength: 0.3,
    filmGrainEnabled: false,
    filmGrainIntensity: 0,
    chromaticAberrationEnabled: false,
    chromaticAberrationStrength: 0,
    depthOfFieldEnabled: false,
    motionBlurEnabled: false,

    maxLights: 4,
    ambientOcclusion: false,
    environmentMapResolution: 128,

    particleCount: 500,
    physicsEnabled: true,

    targetFPS: 30,
    pixelRatio: 1.0,
    antialias: true,
  },

  high: {
    name: 'High',
    quality: 'high',
    weatherPostProcessMode: 'fragment',

    textureResolution: 256,
    anisotropy: 8,

    shadowMapSize: 2048,
    shadowsEnabled: true,
    softShadows: true,

    bloomEnabled: true,
    bloomStrength: 0.5,
    bloomRadius: 0.6,
    bloomThreshold: 0.7,
    vignetteEnabled: true,
    vignetteStrength: 0.4,
    filmGrainEnabled: true,
    filmGrainIntensity: 0.03,
    chromaticAberrationEnabled: true,
    chromaticAberrationStrength: 0.002,
    depthOfFieldEnabled: true,
    motionBlurEnabled: false,

    maxLights: 8,
    ambientOcclusion: true,
    environmentMapResolution: 256,

    particleCount: 2000,
    physicsEnabled: true,

    targetFPS: 60,
    pixelRatio: 1.0,
    antialias: true,
  },

  ultra: {
    name: 'Ultra',
    quality: 'ultra',
    weatherPostProcessMode: 'compute',

    textureResolution: 512,
    anisotropy: 16,

    shadowMapSize: 4096,
    shadowsEnabled: true,
    softShadows: true,

    bloomEnabled: true,
    bloomStrength: 0.6,
    bloomRadius: 0.8,
    bloomThreshold: 0.6,
    vignetteEnabled: true,
    vignetteStrength: 0.5,
    filmGrainEnabled: true,
    filmGrainIntensity: 0.04,
    chromaticAberrationEnabled: true,
    chromaticAberrationStrength: 0.003,
    depthOfFieldEnabled: true,
    motionBlurEnabled: true,

    maxLights: 16,
    ambientOcclusion: true,
    environmentMapResolution: 512,

    particleCount: 5000,
    physicsEnabled: true,

    targetFPS: 60,
    pixelRatio: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2),
    antialias: true,
  },
};

// ============================================================
// Default Quality
// ============================================================

export const DEFAULT_QUALITY: QualityLevel = 'high';

// ============================================================
// Preset Access & Customization
// ============================================================

export function getPreset(level: QualityLevel): VisualPreset {
  return { ...PRESETS[level] };
}

export function createCustomPreset(
  base: QualityLevel,
  overrides: Partial<VisualPreset>,
): VisualPreset {
  return {
    ...PRESETS[base],
    ...overrides,
    quality: overrides.quality ?? PRESETS[base].quality,
  };
}

// ============================================================
// Auto-Detection
// ============================================================

export function detectRecommendedQuality(): QualityLevel {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return DEFAULT_QUALITY;
  }

  const memory = (navigator as unknown as Record<string, unknown>).deviceMemory as number | undefined;
  const cores = navigator.hardwareConcurrency || 2;
  const pixelRatio = window.devicePixelRatio || 1;
  const isMobile =
    /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent);

  let score = 0;

  // Memory scoring (Chrome-only API)
  if (memory !== undefined) {
    if (memory >= 8) score += 3;
    else if (memory >= 4) score += 2;
    else score += 1;
  } else {
    score += 2;
  }

  // CPU core scoring
  if (cores >= 8) score += 3;
  else if (cores >= 4) score += 2;
  else score += 1;

  // Pixel ratio scoring — high DPI screens need more GPU power
  if (pixelRatio <= 1) score += 1;
  else if (pixelRatio <= 2) score += 0;
  else score -= 1;

  // Mobile penalty
  if (isMobile) score -= 2;

  // WebGPU availability bonus
  if ('gpu' in navigator) score += 1;

  if (score >= 7) return 'ultra';
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}
