/**
 * TSL / NodeMaterial twins of the five production cabin `ShaderMaterial`s.
 *
 * Loaded only from `preloadWebGPUCabinRenderer()` so `three/webgpu` stays a
 * further-lazy chunk. GLSL originals remain the WebGL fallback.
 *
 * Uniform bags match the GLSL `ShaderMaterial.uniforms` shape so Vanity /
 * Rearview / animator / overlay code can write `.uniforms.foo.value` on either
 * backend. Graphs follow the GLSL sources in `src/shaders/` — no known look
 * delta; GPU screenshot A/B is a follow-up outside jsdom.
 */
import * as THREE from 'three';
// `three/tsl` is not resolvable under tsconfig `moduleResolution: "node"`
// (node10 ignores package.json `exports`). `three/webgpu` re-exports the TSL
// namespace and already has a working type path in this repo.
import { MeshBasicNodeMaterial, TSL } from 'three/webgpu';
import type { DashboardGlowUniforms } from '../../shaders/dashboardGlow';
import type { RearviewMirrorUniforms } from '../../shaders/rearviewMirrorGlass';
import type { VanityMirrorUniforms } from '../../shaders/vanityMirror';
import type { WindowWeatherOverlayUniforms } from '../../shaders/windowWeatherOverlay';
import type { CupLiquidUniforms } from '../../shaders/cupLiquid';

const {
    Discard,
    Fn,
    If,
    atan,
    clamp,
    distance,
    dot,
    float,
    fract,
    length,
    max,
    mix,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} = TSL;

export type UniformMaterial<U> = THREE.Material & { uniforms: U };

function withUniforms<U>(material: THREE.Material, uniforms: U): UniformMaterial<U> {
    Object.defineProperty(material, 'uniforms', { value: uniforms, enumerable: true });
    return material as UniformMaterial<U>;
}

function overlayMaterial(): InstanceType<typeof MeshBasicNodeMaterial> {
    const material = new MeshBasicNodeMaterial();
    material.lights = false;
    material.transparent = true;
    material.toneMapped = false;
    return material;
}

let dummyRearTex: THREE.Texture | undefined;
function rearDummyTexture(): THREE.Texture {
    if (!dummyRearTex) {
        const data = new Uint8Array([0, 0, 0, 255]);
        dummyRearTex = new THREE.DataTexture(data, 1, 1);
        dummyRearTex.needsUpdate = true;
    }
    return dummyRearTex;
}

export function createVanityMirrorTslMaterial(
    map: THREE.Texture,
    warmthValue = 0.18,
): UniformMaterial<VanityMirrorUniforms> {
    const warmth = uniform(warmthValue);
    const tDiffuse = texture(map);
    const material = overlayMaterial();
    material.colorNode = Fn(() => {
        const vUv = uv();
        const flipped = vec2(vUv.x.oneMinus(), vUv.y);
        const sampled = tDiffuse.sample(flipped).rgb;
        const warmed = mix(sampled, sampled.mul(vec3(1.05, 0.98, 0.92)), warmth);
        const edge = smoothstep(float(0.45), float(0.2), distance(vUv, vec2(0.5)));
        return warmed.mul(mix(float(0.75), float(1.0), edge));
    })();
    material.opacityNode = float(0.92);
    return withUniforms(material, {
        tDiffuse: tDiffuse as unknown as VanityMirrorUniforms['tDiffuse'],
        warmth: warmth as unknown as VanityMirrorUniforms['warmth'],
    });
}

export function createRearviewMirrorTslMaterial(): UniformMaterial<RearviewMirrorUniforms> {
    const nightMode = uniform(0);
    const rearAvailable = uniform(0);
    const timeU = uniform(0);
    const rearPan = uniform(0);
    const rearFade = uniform(0);
    const dummy = rearDummyTexture();
    const rearTexNode = texture(dummy);

    const material = overlayMaterial();
    material.transparent = false;
    material.colorNode = Fn(() => {
        const vUv = uv();
        const nightGlass = vec3(0.03, 0.06, 0.04);
        const dayGlass = vec3(0.06, 0.07, 0.09);
        let glass = mix(dayGlass, nightGlass, step(float(0.5), nightMode)).toVar();

        const dist = distance(vUv, vec2(0.5));
        const vignette = float(1.0).sub(smoothstep(float(0.25), float(0.72), dist));
        glass.assign(glass.mul(mix(float(0.55), float(1.0), vignette)));

        const frost = float(0.02).add(sin(vUv.y.mul(40.0).add(timeU.mul(0.4))).mul(0.015));
        glass.assign(glass.add(vec3(frost)));

        const band = smoothstep(float(0.42), float(0.48), vUv.y).mul(
            float(1.0).sub(smoothstep(float(0.52), float(0.58), vUv.y)),
        );
        const bandX = smoothstep(float(0.18), float(0.28), vUv.x).mul(
            float(1.0).sub(smoothstep(float(0.72), float(0.82), vUv.x)),
        );
        const label = band.mul(bandX);
        const nightLabel = vec3(0.15, 0.45, 0.18);
        const dayLabel = vec3(0.35, 0.38, 0.42);
        const labelColor = mix(dayLabel, nightLabel, step(float(0.5), nightMode));
        glass.assign(mix(glass, labelColor, label.mul(0.85)));

        If(rearAvailable.greaterThan(0.5), () => {
            const rearUv = vec2(float(1.0).sub(vUv.x).add(rearPan), vUv.y);
            const inside = step(vec2(0.0), rearUv).mul(step(rearUv, vec2(1.0)));
            const coverage = inside.x.mul(inside.y);
            const rear = rearTexNode.sample(clamp(rearUv, 0.0, 1.0)).rgb;
            const dimmed = rear
                .mul(mix(float(0.92), float(0.42), nightMode))
                .mul(mix(float(0.6), float(1.0), vignette));
            glass.assign(mix(glass, dimmed, clamp(rearFade, 0.0, 1.0).mul(coverage)));
        });

        return glass;
    })();
    material.opacityNode = float(1);

    const rearTexUniform: RearviewMirrorUniforms['rearTex'] = {
        get value() {
            const current = rearTexNode.value as THREE.Texture | undefined;
            return !current || current === dummy ? null : current;
        },
        set value(tex: THREE.Texture | null) {
            rearTexNode.value = tex ?? dummy;
        },
    };

    return withUniforms(material, {
        nightMode: nightMode as unknown as RearviewMirrorUniforms['nightMode'],
        rearAvailable: rearAvailable as unknown as RearviewMirrorUniforms['rearAvailable'],
        time: timeU as unknown as RearviewMirrorUniforms['time'],
        rearTex: rearTexUniform,
        rearPan: rearPan as unknown as RearviewMirrorUniforms['rearPan'],
        rearFade: rearFade as unknown as RearviewMirrorUniforms['rearFade'],
    });
}

export function createWindowWeatherOverlayTslMaterial(): UniformMaterial<WindowWeatherOverlayUniforms> {
    const timeU = uniform(0);
    const rainIntensity = uniform(0);
    const condensation = uniform(0);
    const wiperPhase = uniform(0);
    const wiperActive = uniform(0);

    const material = overlayMaterial();
    material.depthWrite = false;
    material.depthTest = true;
    material.side = THREE.DoubleSide;
    material.outputNode = Fn(() => {
        const vUv = uv();
        const hash = (x: ReturnType<typeof float>, y: ReturnType<typeof float> = float(0)) =>
            fract(sin(dot(vec2(x, y), vec2(127.1, 311.7))).mul(43758.5453));

        const streak = (seed: number) => {
            const seedF = float(seed);
            const fall = fract(timeU.mul(hash(seedF).mul(0.2).add(0.25)).add(seedF));
            const p = vec2(hash(seedF, float(1.0)), float(1.0).sub(fall));
            const dx = vUv.x.sub(p.x).abs();
            const dy = vUv.y.sub(p.y);
            const body = smoothstep(float(0.004), float(0.0), dx)
                .mul(smoothstep(float(0.06), float(0.0), dy))
                .mul(smoothstep(float(-0.01), float(0.0), dy.sub(0.055)));
            const head = smoothstep(float(0.008), float(0.0), length(vUv.sub(p)));
            const gated = step(seedF, rainIntensity.mul(18.0));
            return max(body, head).mul(gated);
        };

        const rain = float(0).toVar();
        for (let i = 1; i <= 18; i++) {
            rain.addAssign(streak(i));
        }
        rain.assign(clamp(rain, 0.0, 1.0));

        const mist = condensation.mul(
            float(0.35).add(
                sin(vUv.x.mul(40.0).add(timeU.mul(0.15)))
                    .mul(sin(vUv.y.mul(28.0).sub(timeU.mul(0.1))))
                    .mul(0.25),
            ),
        ).mul(smoothstep(float(0.15), float(0.85), vUv.y))
            .mul(smoothstep(float(0.0), float(0.2), vUv.x))
            .mul(smoothstep(float(1.0), float(0.8), vUv.x));

        const sweep = sin(wiperPhase.mul(3.14159265));
        const pivot = vec2(0.25, 0.02);
        const dir = vUv.sub(pivot);
        const ang = atan(dir.x, dir.y).sub(sweep.mul(0.85));
        const arc = smoothstep(float(0.16), float(0.0), ang.abs()).mul(
            smoothstep(float(0.06), float(0.62), length(dir)),
        );
        const pivot2 = vec2(0.75, 0.02);
        const dir2 = vUv.sub(pivot2);
        const ang2 = atan(dir2.x, dir2.y).add(sweep.mul(0.85));
        const arc2 = smoothstep(float(0.16), float(0.0), ang2.abs()).mul(
            smoothstep(float(0.06), float(0.62), length(dir2)),
        );
        const wiperClear = max(arc, arc2).mul(wiperActive);

        rain.assign(rain.mul(float(1.0).sub(wiperClear.mul(0.92))));
        const mistCleared = mist.mul(float(1.0).sub(wiperClear.mul(0.75)));
        const color = mix(vec3(0.75, 0.88, 1.0), vec3(0.92, 0.95, 1.0), mistCleared);
        const alpha = clamp(rain.mul(0.55).add(mistCleared.mul(0.35)), 0.0, 0.75);
        return vec4(color, alpha);
    })();

    const wiperActiveUniform: WindowWeatherOverlayUniforms['wiperActive'] = {
        get value() {
            return (wiperActive.value as number) > 0.5;
        },
        set value(next: boolean) {
            wiperActive.value = next ? 1 : 0;
        },
    };

    return withUniforms(material, {
        time: timeU as unknown as WindowWeatherOverlayUniforms['time'],
        rainIntensity: rainIntensity as unknown as WindowWeatherOverlayUniforms['rainIntensity'],
        condensation: condensation as unknown as WindowWeatherOverlayUniforms['condensation'],
        wiperPhase: wiperPhase as unknown as WindowWeatherOverlayUniforms['wiperPhase'],
        wiperActive: wiperActiveUniform,
    });
}

export function createCupLiquidTslMaterial(
    color: THREE.ColorRepresentation = 0x3a2010,
): UniformMaterial<CupLiquidUniforms> {
    const timeU = uniform(0);
    const liquidColor = uniform(new THREE.Color(color));
    const fillLevel = uniform(0.62);
    const slosh = uniform(0);

    const material = overlayMaterial();
    material.side = THREE.DoubleSide;
    material.colorNode = Fn(() => {
        const vUv = uv();
        const wave = sin(vUv.x.mul(18.0).add(timeU.mul(1.4)))
            .mul(0.012)
            .add(sin(vUv.y.mul(14.0).sub(timeU.mul(0.9))).mul(0.01));
        const tilt = slosh.mul(sin(vUv.x.mul(3.14159)).mul(0.04));
        const surface = fillLevel.add(wave).add(tilt);
        If(vUv.y.greaterThan(surface), () => {
            Discard();
        });
        const depth = surface.sub(vUv.y);
        const col = mix(liquidColor.mul(0.7), liquidColor, clamp(depth.mul(8.0), 0.0, 1.0));
        const spec = pow(max(float(0.0), float(1.0).sub(vUv.y.sub(surface).abs().mul(40.0))), 3.0).mul(0.35);
        return col.add(spec);
    })();
    material.opacityNode = float(0.88);

    return withUniforms(material, {
        time: timeU as unknown as CupLiquidUniforms['time'],
        liquidColor: liquidColor as unknown as CupLiquidUniforms['liquidColor'],
        fillLevel: fillLevel as unknown as CupLiquidUniforms['fillLevel'],
        slosh: slosh as unknown as CupLiquidUniforms['slosh'],
    });
}

export function createDashboardGlowTslMaterial(
    uniforms: DashboardGlowUniforms,
): UniformMaterial<DashboardGlowUniforms> {
    const timeU = uniform(uniforms.time.value);
    const intensity = uniform(uniforms.intensity.value);
    const glowColor = uniform(uniforms.glowColor.value.clone());
    const pulseSpeed = uniform(uniforms.pulseSpeed.value);
    const pulseAmount = uniform(uniforms.pulseAmount.value);
    const glowCenter = uniform(uniforms.glowCenter.value.clone());
    const glowRadius = uniform(uniforms.glowRadius.value);
    const falloff = uniform(uniforms.falloff.value);

    const live: DashboardGlowUniforms = {
        time: timeU as unknown as DashboardGlowUniforms['time'],
        intensity: intensity as unknown as DashboardGlowUniforms['intensity'],
        glowColor: glowColor as unknown as DashboardGlowUniforms['glowColor'],
        pulseSpeed: pulseSpeed as unknown as DashboardGlowUniforms['pulseSpeed'],
        pulseAmount: pulseAmount as unknown as DashboardGlowUniforms['pulseAmount'],
        glowCenter: glowCenter as unknown as DashboardGlowUniforms['glowCenter'],
        glowRadius: glowRadius as unknown as DashboardGlowUniforms['glowRadius'],
        falloff: falloff as unknown as DashboardGlowUniforms['falloff'],
    };

    const material = overlayMaterial();
    material.depthWrite = false;
    material.depthTest = true;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.colorNode = Fn(() => {
        const vUv = uv();
        const dist = length(positionWorld.sub(glowCenter));
        const glow = float(1.0).sub(smoothstep(float(0.0), glowRadius, dist)).toVar();
        glow.assign(pow(glow, falloff));
        const pulse = float(1.0).add(pulseAmount.mul(sin(timeU.mul(pulseSpeed))));
        glow.assign(glow.mul(pulse).mul(intensity));
        const uvDist = length(vUv.sub(vec2(0.5)));
        const vignette = float(1.0).sub(smoothstep(float(0.0), float(0.7), uvDist));
        glow.assign(glow.mul(vignette));
        return glowColor.mul(glow);
    })();
    material.opacityNode = Fn(() => {
        const vUv = uv();
        const dist = length(positionWorld.sub(glowCenter));
        const glow = float(1.0).sub(smoothstep(float(0.0), glowRadius, dist)).toVar();
        glow.assign(pow(glow, falloff));
        const pulse = float(1.0).add(pulseAmount.mul(sin(timeU.mul(pulseSpeed))));
        glow.assign(glow.mul(pulse).mul(intensity));
        const uvDist = length(vUv.sub(vec2(0.5)));
        const vignette = float(1.0).sub(smoothstep(float(0.0), float(0.7), uvDist));
        return glow.mul(vignette);
    })();

    return withUniforms(material, live);
}

export interface CabinTslApi {
    createVanityMirrorMaterial: typeof createVanityMirrorTslMaterial;
    createRearviewMirrorMaterial: typeof createRearviewMirrorTslMaterial;
    createWindowWeatherOverlayMaterial: typeof createWindowWeatherOverlayTslMaterial;
    createCupLiquidMaterial: typeof createCupLiquidTslMaterial;
    createDashboardGlowMaterial: typeof createDashboardGlowTslMaterial;
}

export const cabinTslApi: CabinTslApi = {
    createVanityMirrorMaterial: createVanityMirrorTslMaterial,
    createRearviewMirrorMaterial: createRearviewMirrorTslMaterial,
    createWindowWeatherOverlayMaterial: createWindowWeatherOverlayTslMaterial,
    createCupLiquidMaterial: createCupLiquidTslMaterial,
    createDashboardGlowMaterial: createDashboardGlowTslMaterial,
};
