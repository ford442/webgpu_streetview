import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readShader(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shaders', name), 'utf8');
}

function extractFunctionBody(source: string, functionName: string): string {
  const signature = `fn ${functionName}(`;
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`Function ${functionName} not found`);
  }

  const openBrace = source.indexOf('{', start);
  if (openBrace === -1) {
    throw new Error(`Function ${functionName} has no opening brace`);
  }

  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(openBrace + 1, i);
    }
  }

  throw new Error(`Function ${functionName} has unbalanced braces`);
}

function normalizeWgsl(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}();,+\-*/=<>])\s*/g, '$1')
    .trim();
}

function normalizeSnowBody(code: string): string {
  return normalizeWgsl(code)
    .replace('let wind=p_wind();', '')
    .replace('let snowInt=p_snowIntensity();', '')
    .replace(/p\.wind/g, 'wind')
    .replace(/p\.snowIntensity/g, 'snowInt');
}

/**
 * Compute-path helpers read uniforms through `p_name()` accessors where the
 * fragment path uses `p.name`. Normalize that difference so shared bodies can
 * be compared verbatim.
 */
function normalizeAccessors(code: string): string {
  return normalizeWgsl(code)
    .replace(/p_([A-Za-z0-9]+)\(\)/g, 'p.$1')
    .replace(/readTexture/g, 'sceneTex')
    .replace(/u_sampler/g, 'linearSampler');
}

describe('weather shader parity guard', () => {
  it('keeps applyNight identical between fragment and compute paths', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    const fragmentNight = normalizeWgsl(extractFunctionBody(fragment, 'applyNight'));
    const computeNight = normalizeWgsl(extractFunctionBody(compute, 'applyNight'));

    expect(computeNight).toBe(fragmentNight);
  });

  it('keeps snow motion math aligned between fragment and compute paths', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    const fragmentSnow = normalizeSnowBody(extractFunctionBody(fragment, 'snow'));
    const computeSnow = normalizeSnowBody(extractFunctionBody(compute, 'snow'));

    expect(computeSnow).toBe(fragmentSnow);
  });

  it.each(['viewHorizonY', 'viewDepthProxy', 'fogHeightFalloff'])(
    'keeps the %s depth-proxy helper identical between fragment and compute paths',
    (fnName) => {
      const fragment = readShader('weather-post.wgsl');
      const compute = readShader('weather-post-compute.wgsl');

      expect(normalizeWgsl(extractFunctionBody(compute, fnName)))
        .toBe(normalizeWgsl(extractFunctionBody(fragment, fnName)));
    }
  );

  it.each([
    'applyFog',
    'applySunrise',
    'applyCameraFX',
    'applyDustParticles',
    'applyVolumetricLightShafts',
  ])(
    'keeps %s aligned between fragment and compute paths',
    (fnName) => {
      const fragment = readShader('weather-post.wgsl');
      const compute = readShader('weather-post-compute.wgsl');

      expect(normalizeAccessors(extractFunctionBody(compute, fnName)))
        .toBe(normalizeAccessors(extractFunctionBody(fragment, fnName)));
    }
  );

  it('binds the WASM noise tile in both paths (no compute-only dust regression)', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    // Both must sample the tile for dust cloud density.
    for (const source of [fragment, compute]) {
      expect(source).toContain('fn sampleWasmNoiseTile(');
      expect(source).toMatch(/cloudDensity = 0\.35 \+ 0\.65 \* \(0\.5 \+ 0\.5 \* sampleWasmNoiseTile\(cloudUV\)\)/);
    }

    // The compute path reads it through the plasmaBuffer slot (binding 12).
    expect(compute).toMatch(/@group\(0\) @binding\(12\) var<storage, read> plasmaBuffer/);
    expect(compute).toContain('plasmaBuffer[i / 4]');
  });

  it('keeps sampleWasmNoiseTile filtering identical across the vec4 packing', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    // The compute path reads the same 64x64 f32 tile through a vec4 view, so
    // its taps go via wasmNoiseAt(i) where the fragment path indexes the flat
    // array directly. Everything else — wrap, bilinear weights, mix order —
    // must match, or dust clumping would differ between the two pipelines.
    const normalizeTileSampler = (code: string): string =>
      normalizeWgsl(code).replace(/wasmNoiseAt\(([^)]*)\)/g, 'wasmNoiseTile[$1]');

    expect(normalizeTileSampler(extractFunctionBody(compute, 'sampleWasmNoiseTile')))
      .toBe(normalizeTileSampler(extractFunctionBody(fragment, 'sampleWasmNoiseTile')));
  });

  it('sizes the compute tile view to exactly one 64x64 tile', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    // Fragment path: 4096 flat floats. Compute path: the same 4096 values read
    // as 1024 vec4s, clamped to the last valid element.
    expect(fragment).toMatch(/wasmNoiseTile:\s*array<f32,\s*4096>/);
    expect(compute).toContain('clamp(index, 0, 4095)');
  });

  it('uses previous-frame depth for temporal fog on the compute path only', () => {
    const compute = readShader('weather-post-compute.wgsl');
    expect(compute).toContain('textureLoad(readDepthTexture');
    expect(compute).toMatch(/fn fogAmountAt\([^)]*coord: vec2<i32>/);
  });

  it('writes the depth proxy into the compute pass storage texture', () => {
    const compute = readShader('weather-post-compute.wgsl');
    expect(compute).toMatch(/textureStore\(\s*writeDepthTexture/);
  });

  it('keeps precipitation fog attenuation aligned across WGSL paths', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    for (const source of [fragment, compute]) {
      expect(source).toContain('let precipVisibility = 1.0 - fogMask * 0.75;');
    }
  });

  it('keeps night headlight multipliers aligned across WGSL paths', () => {
    const fragment = readShader('weather-post.wgsl');
    const compute = readShader('weather-post-compute.wgsl');

    const fragmentMatch = fragment.match(/let\s+nightMul\s*=\s*mix\(0\.55,\s*1\.15,\s*p\.nightIntensity\)/);
    const computeMatch = compute.match(/let\s+nightMul\s*=\s*mix\(0\.55,\s*1\.15,\s*p_nightIntensity\(\)\)/);

    expect(fragmentMatch).not.toBeNull();
    expect(computeMatch).not.toBeNull();
  });

  it('keeps the fragment rain/snow functions free of the GPU particle layer', () => {
    const fragment = readShader('weather-post.wgsl');
    expect(fragment).not.toContain('fn applyParticlePrecipitation(');
    expect(fragment).not.toContain('dataTextureA');
  });

  it('composites GPU particle density on the compute path only', () => {
    const compute = readShader('weather-post-compute.wgsl');
    expect(compute).toContain('fn applyParticlePrecipitation(');
    expect(compute).toMatch(/@group\(0\) @binding\(7\) var dataTextureA: texture_2d<f32>/);
    expect(compute).toMatch(/@group\(0\) @binding\(8\) var dataTextureB: texture_storage_2d<rgba32float, write>/);
    expect(compute).toContain('col = col + particleLayer * precipVisibility');
    expect(compute).not.toMatch(/@binding\(7\) var dataTextureA: texture_storage_2d/);
  });

  it('integrates particles with the documented downward fall sign', () => {
    const particles = readShader('weather-particles.wgsl');
    expect(particles).toContain('const FALL_Y: f32 = -1.0;');
    expect(particles).toContain('const WIND_SCALE: f32 = 0.35;');
    expect(particles).toContain('fn integrate(');
    expect(particles).toContain('fn splat(');
  });
});
