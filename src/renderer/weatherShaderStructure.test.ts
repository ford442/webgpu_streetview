/**
 * Invariants of the weather post-process shaders (both paths).
 *
 * Every helper is written once, in `src/shaders/weather/*.wesl` or
 * `src/shaders/lib/*.wesl`, and linked into both `weather-post*.wgsl` and
 * `weather-post-compute*.wgsl` (`linkedShaders.test.ts` proves there is no
 * second copy), so the old fragment-vs-compute parity checks have nothing left
 * to compare. What stays is what each path must *do*: the weight-0 guards that
 * keep depth / horizon bit-exact, which layers are compute-only, and that every
 * effect reads the shared horizon and depth. Helper bodies are read from their
 * source; whole-shader properties from the linked WGSL the device compiles.
 */
import { describe, expect, it } from 'vitest';
import { fnSource, readLinked, readWesl, squash } from '../shaders/__tests__/shaderSources';

const FRAGMENT = 'weather-post.wgsl';
const COMPUTE = 'weather-post-compute.wgsl';
const PATHS = [FRAGMENT, COMPUTE] as const;
const body = (source: string, name: string) => {
    const fn = fnSource(source, name);
    return fn.slice(fn.indexOf('{') + 1, fn.lastIndexOf('}'));
};

describe('weather shaders: one horizon, one depth', () => {
    it('ties rain/snow to the shared horizon helper instead of a flat screen-Y overlay', () => {
        const precip = readWesl('weather/precip.wesl');
        for (const fnName of ['rain', 'snow']) {
            const code = body(precip, fnName);
            expect(code).toContain('sceneHorizonY()');
            expect(code).toContain('sceneDepth(uv, horizonY)');
            expect(code).toContain('skyFade');
            expect(code).toContain('nearBoost');
        }
    });

    it('guards depth blend 0 so sceneDepth stays bit-exact with the proxy (#320)', () => {
        // The proxy is computed first and returned untouched — no mix() — when
        // blend is 0, which is every frame without a depth map.
        expect(squash(body(readWesl('lib/sceneDepth.wesl'), 'sceneDepth')).startsWith(
            'let proxy=viewDepthProxy(uv,horizonY);'
            + 'if(depthParams.blend<=0.0){return proxy;}',
        )).toBe(true);
    });

    it('occludes precipitation layers only when a depth map is blended in; blend 0 keeps the old accumulate verbatim', () => {
        const precip = readWesl('weather/precip.wesl');
        expect(squash(body(precip, 'rain'))).toContain(
            'if(depthParams.blend>0.0){c=c+streak*(0.7+seed*0.8)*precipOcclusion(layer,4.0,depth);}'
            + 'else{c=c+streak*(0.7+seed*0.8);}',
        );
        expect(squash(body(precip, 'snow'))).toContain(
            'if(depthParams.blend>0.0){c=c+flake*(0.85+rnd*0.6)*precipOcclusion(layer,5.0,depth);}'
            + 'else{c=c+flake*(0.85+rnd*0.6);}',
        );
    });

    it.each(PATHS)('%s routes every depth consumer through sceneDepth — viewDepthProxy is read only inside it', (name) => {
        const source = readLinked(name);
        expect(source.match(/fn sceneDepth\(/g)).toHaveLength(1);
        // One definition + the one call inside sceneDepth.
        expect(source.match(/viewDepthProxy\(/g)).toHaveLength(2);
        expect(body(source, 'sceneDepth')).toContain('viewDepthProxy(uv, horizonY)');
        // rain, snow, fog, DOF and the semantic wet road (#352) in both paths;
        // plus the compute path's per-pixel depth.
        expect(source.match(/sceneDepth\(uv, horizonY\)/g)).toHaveLength(name === COMPUTE ? 6 : 5);
    });

    it('binds scene depth at group 2 in both weather paths (lib/sceneDepth.wesl, scene_depth_group1 off)', () => {
        for (const name of PATHS) {
            const source = readLinked(name);
            expect(source).toContain('@group(2) @binding(0) var sceneDepthTex: texture_2d<f32>;');
            expect(source).toContain('@group(2) @binding(1) var sceneDepthSampler: sampler;');
            expect(source).toContain('@group(2) @binding(2) var<uniform> depthParams: SceneDepthParams;');
        }
    });

    it('reads the horizon through sceneHorizonY (pitch + image estimate + blend)', () => {
        expect(squash(body(readWesl('weather/horizon.wesl'), 'sceneHorizonY')))
            .toBe('return viewHorizonY(p_cameraPitch(),p_horizonEstimateY(),p_horizonBlend());');
        for (const name of PATHS) {
            const source = readLinked(name);
            expect(source.match(/fn viewHorizonY\(/g)).toHaveLength(1);
            expect(source.match(/fn sceneHorizonY\(/g)).toHaveLength(1);
            // The only direct viewHorizonY call is the one inside sceneHorizonY.
            expect((source.match(/viewHorizonY\(/g) ?? []).length - 1).toBe(1);
        }
    });

    it('guards the weight-0 horizon so it stays bit-exact with the pitch-only formula', () => {
        expect(squash(body(readWesl('weather/horizon.wesl'), 'viewHorizonY'))).toBe(
            'let predicted=0.5+(cameraPitchNorm-0.5)*2.0;'
            + 'let w=clamp(blend,0.0,1.0);'
            + 'return clamp(select(predicted,mix(predicted,estimateY,w),w>0.0),-0.75,1.75);',
        );
    });
});

describe('weather shaders: the two paths and their bindings', () => {
    it('reads each weather param through its accessor in shared helpers, never the fragment-only `p`', () => {
        for (const [path, code] of [
            'weather/atmosphere.wesl', 'weather/grade.wesl', 'weather/horizon.wesl', 'weather/lens.wesl',
            'weather/night.wesl', 'weather/precip.wesl', 'weather/semantic.wesl', 'weather/sky.wesl',
        ].map((p) => [p, readWesl(p)] as const)) {
            expect(code.replace(/\/\/.*$/gm, ''), path).not.toMatch(/\bp\.\w/);
            expect(code.replace(/\/\/.*$/gm, ''), path).not.toMatch(/\bextraBuffer\b|\bep\(/);
        }
    });

    it('samples the scene with implicit derivatives in the fragment pass and level 0 in compute', () => {
        expect(squash(body(readLinked(FRAGMENT), 'sampleScene'))).toBe('return textureSample(sceneTex,linearSampler,uv);');
        expect(squash(body(readLinked(COMPUTE), 'sampleScene'))).toBe('return textureSampleLevel(sceneTex,linearSampler,uv,0.0);');
    });

    it('binds the WASM noise tile in both paths (no compute-only dust regression)', () => {
        for (const name of PATHS) {
            const source = readLinked(name);
            expect(source).toContain('fn sampleWasmNoiseTile(');
            expect(source).toMatch(/cloudDensity = 0\.35 \+ 0\.65 \* \(0\.5 \+ 0\.5 \* sampleWasmNoiseTile\(cloudUV\)\)/);
        }
        // Fragment path: 4096 flat floats. Compute path: the same 4096 values
        // read as 1024 vec4s through the plasmaBuffer slot (binding 12), clamped
        // to the last valid element.
        expect(readLinked(FRAGMENT)).toMatch(/wasmNoiseTile:\s*array<f32,\s*4096>/);
        const compute = readLinked(COMPUTE);
        expect(compute).toMatch(/@group\(0\) @binding\(12\) var<storage, read> plasmaBuffer/);
        expect(compute).toContain('plasmaBuffer[i / 4]');
        expect(compute).toContain('clamp(index, 0, 4095)');
    });

    it('skips 3D LUT sampling when the dummy 1³ texture is bound', () => {
        for (const name of PATHS) {
            const source = readLinked(name);
            expect(source).toContain('fn applyLut(');
            expect(source).toMatch(/if \(dim <= 1u\)/);
            expect(source).toContain('textureDimensions(lut3d)');
        }
    });

    it('keeps TAA/DOF history compute-only and dummy-gated', () => {
        expect(readLinked(FRAGMENT)).not.toContain('applyTemporalHistory');
        const compute = readLinked(COMPUTE);
        expect(compute).toContain('fn applyTemporalHistory(');
        expect(compute).toMatch(/histSize\.x <= 1u/);
        expect(compute).toContain('textureLoad(dataTextureC');
    });

    it('uses previous-frame depth for temporal fog on the compute path only', () => {
        const compute = readLinked(COMPUTE);
        expect(compute).toContain('textureLoad(readDepthTexture');
        expect(compute).toMatch(/fn fogAmountAt\([^)]*coord: vec2<i32>/);
        expect(readLinked(FRAGMENT)).not.toContain('readDepthTexture');
        expect(readLinked(FRAGMENT)).not.toMatch(/fn fogAmountAt\([^)]*coord/);
    });

    it('writes the depth proxy into the compute pass storage texture', () => {
        expect(readLinked(COMPUTE)).toMatch(/textureStore\(\s*writeDepthTexture/);
    });

    it.each(PATHS)('%s attenuates precipitation by the fog and keeps the night headlight multiplier', (name) => {
        const source = readLinked(name);
        expect(source).toContain('let precipVisibility = 1.0 - fogMask * 0.75;');
        expect(source).toMatch(/let\s+nightMul\s*=\s*mix\(0\.55,\s*1\.15,\s*(p\.nightIntensity|p_nightIntensity\(\))\)/);
    });

    it('keeps the GPU particle layer on the compute path only', () => {
        const fragment = readLinked(FRAGMENT);
        expect(fragment).not.toContain('fn applyParticlePrecipitation(');
        expect(fragment).not.toContain('dataTextureA');
        const compute = readLinked(COMPUTE);
        expect(compute).toContain('fn applyParticlePrecipitation(');
        expect(compute).toMatch(/@group\(0\) @binding\(7\) var dataTextureA: texture_2d<f32>/);
        expect(compute).toMatch(/@group\(0\) @binding\(8\) var dataTextureB: texture_storage_2d<rgba32float, write>/);
        expect(compute).toContain('col = col + particleLayer * precipVisibility');
    });

    it('integrates particles with the documented downward fall sign', () => {
        const particles = readLinked('weather-particles.wgsl');
        expect(particles).toContain('const FALL_Y: f32 = -1.0;');
        expect(particles).toContain('const WIND_SCALE: f32 = 0.35;');
        expect(particles).toContain('fn integrate(');
        expect(particles).toContain('fn splat(');
    });
});
