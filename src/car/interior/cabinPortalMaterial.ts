/**
 * TSL material and clipping group for the windshield **portal** — the WebGPU
 * cabin's replacement for the decal overlay when the shared device has
 * `clip-distances`. Loaded only from `cabinTslMaterials.ts`, i.e. with the
 * further-lazy `three/webgpu` chunk.
 *
 * ### What it draws
 *
 * The glass stays a hole: the road frame `weather-post` wrote shows through it,
 * fully graded and weathered. On top of that hole this material draws only where
 * the wet layer is optically active:
 *
 * - **Droplets** — two grid layers of sliding beads. Each is a lens: the pixel
 *   inside it samples the road's **HDR intermediate** at the inverted, magnified
 *   position (`-(1 + g)·d` about the bead centre, `g` growing toward the rim),
 *   converts it to the road's display look, and adds a dark rim and a specular.
 * - **Condensation mist** — the decal's tinted film, unchanged.
 *
 * Both are gated by the **wet mask** (`windshieldWetMask.ts`): where the wipers
 * have passed, beads shrink to nothing and mist thins, then they re-form.
 *
 * ### Why only the lens interiors sample the road
 *
 * The intermediate is *pre*-`weather-post`: ungraded, no night, no fog, no ACES.
 * A portal that replaced the whole glass with it would show a different image
 * from the hole beside it — a bright daytime scene through the windshield at
 * night. Confining the sample to the lens interiors bounds any mismatch to
 * beads a few pixels wide, and `createRoadDisplay` below mirrors the parts of
 * `fs_main` that dominate the look (grade, night, vignette, rain darkening, ACES)
 * from the same packed weather values the road used (`RoadLook`). Fog, haze,
 * dust, headlights and named-look LUTs are not mirrored: a known, small delta
 * inside lenses (see `docs/RENDERER_FALLBACK.md`).
 *
 * ### Screen mapping
 *
 * Bead geometry lives in glass-UV space (it must, or beads would slide with the
 * screen instead of the glass as the head turns), but the road is sampled in
 * screen space. Glass-space offsets are converted to screen offsets with the
 * local Jacobian from `dFdx`/`dFdy` — which WGSL only allows in uniform control
 * flow, so every derivative is taken before the first branch, and every texture
 * read uses an explicit level.
 *
 * ### Clipping
 *
 * The portal mesh is built under `WorldPlaneClippingGroup`. With `clip-distances`
 * three's node builder emits the planes as hardware clip distances instead of a
 * fragment `discard` (`NodeMaterial.setupHardwareClipping`).
 */
import * as THREE from 'three';
import { ClippingGroup, MeshBasicNodeMaterial, TSL } from 'three/webgpu';
import { DEFAULT_GLASS_ASPECT } from './windshieldAperture';
import {
    WET_MASK_ROW_LEFT,
    WET_MASK_ROW_RIGHT,
    WET_MASK_THETA_MAX,
    WET_MASK_THETA_MIN,
} from './windshieldWetMask';
import {
    WIPER_PIVOT_LEFT,
    WIPER_PIVOT_RIGHT,
    WIPER_RADIAL_END,
    WIPER_RADIAL_START,
} from './windshieldWiperGeometry';

const {
    Fn,
    If,
    atan,
    clamp,
    dFdx,
    dFdy,
    dot,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    pow,
    screenUV,
    sign,
    sin,
    smoothstep,
    sRGBTransferEOTF,
    step,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} = TSL;

// TSL's fluent node typings do not model arithmetic across vec sizes; the graph
// is validated by compiling and running it (`e2e/windshield-portal.spec.ts`), not by tsc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/**
 * The ACES fit `weather-post` ends on (`aces_tonemap`, SDR body). Mirrored
 * literally; `windshieldPortal.parity.test.ts` reads the WGSL and fails if the
 * road's coefficients move.
 */
export const PORTAL_ACES = { a: 2.51, b: 0.03, c: 2.43, d: 0.59, e: 0.14 } as const;

/**
 * `applyNight`'s constants, likewise pinned by the parity test. The star field
 * and dither noise are not mirrored.
 */
export const PORTAL_NIGHT = {
    floorDaylight: 0.14,
    desaturate: 0.55,
    moonTint: [0.10, 0.14, 0.28] as const,
    moonTintGain: 0.10,
    skyDarken: 0.18,
    /** `smoothstep(skyEdgeHi, skyEdgeLo, uv.y)` — written reversed in the WGSL. */
    skyEdges: [0.55, 0.05] as const,
    lightMaskEdges: [0.28, 0.85] as const,
    lightPreserve: 0.65,
    vignetteAspect: [1.3, 1.0] as const,
    vignetteEdges: [0.35, 1.05] as const,
    vignette: 0.28,
    floor: 0.008,
} as const;

/** `applyVignette` — always on in `fs_main`, so it is on for every lens pixel too. */
export const PORTAL_VIGNETTE = { aspect: [1.2, 1.0] as const, edges: [0.5, 1.3] as const, strength: 0.4 } as const;

/** `fs_main`'s "scene darkening under rain": `1 - rain * mix(day, night, nightIntensity)`. */
export const PORTAL_RAIN_DARKEN = { day: 0.22, night: 0.10 } as const;

export interface WindshieldPortalUniforms {
    time: { value: number };
    /** Cabin-normalised 0..1 rain, including the wiper-on-dry-glass mist seed. */
    rainIntensity: { value: number };
    condensation: { value: number };
    glassAspect: { value: number };
    /** The slot `RoadFrameBinding` points at the road's HDR intermediate. */
    hdrFrame: { value: unknown };
    // RoadLook mirror
    vibrance: { value: number };
    saturation: { value: number };
    contrast: { value: number };
    exposure: { value: number };
    /** `kelvinToRGB(6500 + temperature·5000) / kelvinToRGB(6500)` with tint applied — computed on the CPU. */
    tempMult: { value: THREE.Vector3 };
    nightIntensity: { value: number };
    /** Shader-space rain (0..2), for the road's scene darkening. */
    roadRain: { value: number };
    /** 1 when `weather-post` grades; 0 when it returns the raw intermediate. */
    graded: { value: number };
}

export type WindshieldPortalMaterial = THREE.Material & { uniforms: WindshieldPortalUniforms };

let dummyHdrTexture: THREE.Texture | undefined;
/** Bound until the first road frame arrives, so the graph always has a valid texture. */
function dummyHdr(): THREE.Texture {
    if (!dummyHdrTexture) {
        dummyHdrTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        dummyHdrTexture.needsUpdate = true;
    }
    return dummyHdrTexture;
}

/** Explicit-level read: legal in non-uniform control flow, unlike an implicit-derivative `textureSample`. */
const sampleLevel0 = (tex: Node, uvNode: Node): Node => (tex.sample(uvNode) as Node).level(0);

const LUMA = vec3(0.2126, 0.7152, 0.0722);
const luma = (c: Node) => dot(c, LUMA);

/** Reversed-edge `smoothstep(e0 > e1, x)`, written the way WGSL defines it (edge0 < edge1). */
const smoothDown = (hi: number, lo: number, x: Node) => float(1).sub(smoothstep(float(lo), float(hi), x));

/**
 * The road-look mirror as a standalone graph: grade → night → vignette → rain
 * darkening → ACES, from the same packed weather values the road used (`RoadLook`).
 *
 * Split out of the portal material so it can be compiled and compared against the
 * real `weather-post` shader on a GPU (`e2e/windshield-portal.spec.ts`) without
 * standing up a whole windshield.
 *
 * `display` uses `If` / `toVar`, so it must be called inside a TSL `Fn` body.
 */
export function createRoadDisplay() {
    const vibranceU = uniform(0);
    const saturationU = uniform(0);
    const contrastU = uniform(0);
    const exposureU = uniform(0);
    const tempMultU = uniform(new THREE.Vector3(1, 1, 1));
    const nightU = uniform(0);
    const roadRainU = uniform(0);
    const gradedU = uniform(1);

    /**
     * Mirror of the tail of `weather-post` `fs_main` that the lens interiors need
     * (grade → night → vignette → rain darkening → ACES). Returns the display
     * value the road would have written for this texel.
     */
    const display = (hdr: Node, sUV: Node) => {
        const c = hdr.toVar();

        If(gradedU.greaterThan(0.5), () => {
            // applyVibrance
            const l0 = luma(c);
            const sat0 = max(max(c.r, c.g), c.b).sub(l0);
            c.assign(c.add(c.sub(l0).mul(vibranceU).mul(float(1).sub(sat0))));
            // applySaturation
            c.assign(mix(vec3(luma(c)), c, float(1).add(saturationU)));
            // applyContrast
            c.assign(c.sub(0.5).mul(float(1).add(contrastU)).add(0.5));
            // applyTemperatureTint
            c.assign(c.mul(tempMultU));
            // applyExposure
            c.assign(c.mul(pow(float(2), exposureU)));

            // applyNight — minus the star field and dither noise
            If(nightU.greaterThan(0.001), () => {
                const graded = c.toVar();
                const night = nightU;
                const curve = night.mul(night).mul(float(3).sub(night.mul(2)));
                c.assign(c.mul(mix(float(1), float(PORTAL_NIGHT.floorDaylight), curve)));
                const gray = luma(c);
                c.assign(mix(c, vec3(gray), night.mul(PORTAL_NIGHT.desaturate)));
                c.assign(c.add(vec3(...PORTAL_NIGHT.moonTint).mul(night).mul(PORTAL_NIGHT.moonTintGain)));
                const skyDarken = smoothDown(PORTAL_NIGHT.skyEdges[0], PORTAL_NIGHT.skyEdges[1], sUV.y);
                c.assign(c.mul(mix(float(1), float(PORTAL_NIGHT.skyDarken), skyDarken.mul(night))));
                const lightMask = smoothstep(
                    float(PORTAL_NIGHT.lightMaskEdges[0]),
                    float(PORTAL_NIGHT.lightMaskEdges[1]),
                    luma(graded),
                );
                c.assign(c.add(graded.mul(lightMask).mul(night).mul(PORTAL_NIGHT.lightPreserve)));
                const centerDist = length(sUV.sub(0.5).mul(vec2(...PORTAL_NIGHT.vignetteAspect)));
                const vig = float(1).sub(
                    smoothstep(
                        float(PORTAL_NIGHT.vignetteEdges[0]),
                        float(PORTAL_NIGHT.vignetteEdges[1]),
                        centerDist,
                    ).mul(night).mul(PORTAL_NIGHT.vignette),
                );
                c.assign(c.mul(vig));
                c.assign(max(c, vec3(PORTAL_NIGHT.floor)));
            });

            // applyVignette — always on in fs_main, up to 40% at the corners
            const vigDist = length(sUV.sub(0.5).mul(vec2(...PORTAL_VIGNETTE.aspect)));
            c.assign(
                c.mul(
                    float(1).sub(
                        smoothstep(float(PORTAL_VIGNETTE.edges[0]), float(PORTAL_VIGNETTE.edges[1]), vigDist)
                            .mul(PORTAL_VIGNETTE.strength),
                    ),
                ),
            );

            // scene darkening under rain (fs_main, "WEATHER EFFECTS")
            c.assign(
                c.mul(
                    float(1).sub(
                        roadRainU.mul(mix(float(PORTAL_RAIN_DARKEN.day), float(PORTAL_RAIN_DARKEN.night), nightU)),
                    ),
                ),
            );

            // aces_tonemap
            const { a, b, c: cc, d, e } = PORTAL_ACES;
            c.assign(
                clamp(
                    c.mul(c.mul(a).add(b)).div(c.mul(c.mul(cc).add(d)).add(e)),
                    vec3(0),
                    vec3(1),
                ),
            );
        });

        return c;
    };

    return {
        display,
        uniforms: {
            vibrance: vibranceU,
            saturation: saturationU,
            contrast: contrastU,
            exposure: exposureU,
            tempMult: tempMultU,
            nightIntensity: nightU,
            roadRain: roadRainU,
            graded: gradedU,
        },
    };
}

export function createWindshieldPortalTslMaterial(
    wetMask: THREE.Texture,
): WindshieldPortalMaterial {
    const timeU = uniform(0);
    const rainU = uniform(0);
    const condensationU = uniform(0);
    const aspectU = uniform(DEFAULT_GLASS_ASPECT);
    const road = createRoadDisplay();

    const hdrNode = texture(dummyHdr());
    const wetNode = texture(wetMask);

    const hash21 = (p: Node) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
    const hash22 = (p: Node) => vec2(hash21(p), hash21(p.add(vec2(19.19, 7.77))));

    const material = new MeshBasicNodeMaterial();
    material.lights = false;
    material.transparent = true;
    material.toneMapped = false;
    material.depthWrite = false;
    material.depthTest = true;
    material.side = THREE.DoubleSide;

    material.outputNode = Fn(() => {
        const g = uv();
        const gAsp = vec2(g.x.mul(aspectU), g.y);
        const sUV = screenUV;

        // --- derivatives: uniform control flow only, so before any If ---
        const dgdx = dFdx(gAsp);
        const dgdy = dFdy(gAsp);
        const sPerPx = vec2(dFdx(sUV).x, dFdy(sUV).y);
        const det = dgdx.x.mul(dgdy.y).sub(dgdy.x.mul(dgdx.y));
        const invDet = sign(det).div(max(det.abs(), float(1e-12)));
        // glass-space offset -> screen-UV offset, through the inverse Jacobian
        const toScreen = (d: Node) =>
            vec2(
                dgdy.y.mul(d.x).sub(dgdy.x.mul(d.y)),
                dgdx.x.mul(d.y).sub(dgdx.y.mul(d.x)),
            ).mul(invDet).mul(sPerPx);

        // --- wet mask: 1 = wet, 0 = just wiped ---
        const wetFor = (pivot: readonly [number, number], rowCentre: number) => {
            const dir = g.sub(vec2(pivot[0], pivot[1]));
            const theta = atan(dir.x, dir.y);
            const u = theta.sub(WET_MASK_THETA_MIN).div(WET_MASK_THETA_MAX - WET_MASK_THETA_MIN);
            const along = sampleLevel0(wetNode, vec2(u, rowCentre)).r;
            const radial = smoothstep(float(WIPER_RADIAL_START), float(WIPER_RADIAL_END), length(dir));
            return float(1).sub(float(1).sub(along).mul(radial));
        };
        const wet = min(
            wetFor(WIPER_PIVOT_LEFT, (WET_MASK_ROW_LEFT + 0.5) / 2),
            wetFor(WIPER_PIVOT_RIGHT, (WET_MASK_ROW_RIGHT + 0.5) / 2),
        );
        const wetGate = smoothstep(float(0.15), float(0.7), wet);

        // --- droplet layers ---
        const layer = (
            scale: number,
            seed: number,
            coverage: Node,
            radiusMin: number,
            radiusMax: number,
            rate: number,
        ) => {
            const p = gAsp.mul(scale);
            const cell = floor(p).add(vec2(seed, seed * 1.7));
            const f = fract(p).sub(0.5);
            const h = hash22(cell);
            const life0 = hash22(cell.add(31.31));
            const t = timeU.mul(rate).add(life0.x);
            const gen = floor(t);
            const life = fract(t);
            // a fresh position each generation, then a slow slide down the glass
            const h3 = hash22(cell.add(gen.mul(13.37)));
            const pos = h3.sub(0.5).mul(0.4).add(vec2(0, life.sub(0.5).mul(-0.2)));
            const present = step(h.x, coverage);
            const grow = smoothstep(float(0), float(0.12), life).mul(smoothDown(1.0, 0.85, life));
            const r = mix(float(radiusMin), float(radiusMax), h.y).mul(grow).mul(wetGate).max(float(1e-4));
            const d = f.sub(pos);
            const dist = length(d);
            const inside = smoothDown(1.0, 0.82, dist.div(r)).mul(present);
            return { inside, d: d.div(scale), rn: dist.div(r), r: r.div(scale) };
        };

        const rain = rainU;
        const fine = layer(14, 0.0, clamp(rain.mul(1.4), float(0), float(1)).mul(0.8), 0.10, 0.20, 0.09);
        const large = layer(5, 7.0, clamp(rain.mul(0.55), float(0), float(1)), 0.14, 0.22, 0.05);

        const useLarge = step(fine.inside, large.inside);
        const inside = max(fine.inside, large.inside);
        const d = mix(fine.d, large.d, useLarge);
        const rn = mix(fine.rn, large.rn, useLarge);
        const rGlass = mix(fine.r, large.r, useLarge);

        // --- lens: inverted, magnified sample of the road; stronger bend toward the rim ---
        const gain = mix(float(0.45), float(0.95), rn.mul(rn));
        const lensUV = clamp(
            sUV.add(toScreen(d.mul(float(-1).sub(gain)))),
            vec2(0.001),
            vec2(0.999),
        );
        const hdr = sampleLevel0(hdrNode, lensUV).rgb;
        const shown = road.display(hdr, sUV).toVar();

        const edge = smoothstep(float(0.55), float(1.0), rn);
        shown.assign(shown.mul(float(1).sub(edge.mul(0.45))));
        const unit = d.div(rGlass.max(float(1e-5)));
        const spec = smoothDown(0.32, 0.0, length(unit.sub(vec2(-0.35, 0.4))));
        shown.assign(shown.add(vec3(0.9, 0.95, 1.0).mul(spec).mul(0.5)));

        // three renders the cabin in linear working space and the output pass
        // sRGB-encodes it, while the road wrote its ACES value to the swap chain
        // unencoded — so decode here, and the encode lands on the road's own value.
        const lensLinear = sRGBTransferEOTF(clamp(shown, vec3(0), vec3(1)));
        const lensA = inside.mul(0.94);

        // --- condensation mist (the decal's film), thinned where wiped ---
        const mistBase = condensationU.mul(
            float(0.35).add(
                sin(g.x.mul(40).add(timeU.mul(0.15))).mul(sin(g.y.mul(28).sub(timeU.mul(0.1)))).mul(0.25),
            ),
        )
            .mul(smoothstep(float(0.15), float(0.85), g.y))
            .mul(smoothstep(float(0.0), float(0.2), g.x))
            .mul(smoothDown(1.0, 0.8, g.x));
        const mist = mistBase.mul(float(1).sub(float(1).sub(wet).mul(0.75)));
        const mistA = mist.mul(0.35);
        const mistColour = mix(vec3(0.75, 0.88, 1.0), vec3(0.92, 0.95, 1.0), mist);

        const a = lensA.add(mistA.mul(float(1).sub(lensA)));
        const rgb = lensLinear
            .mul(lensA)
            .add(mistColour.mul(mistA).mul(float(1).sub(lensA)))
            .div(a.max(float(1e-4)));
        return vec4(rgb, clamp(a, float(0), float(0.97)));
    })();

    const uniforms: WindshieldPortalUniforms = {
        time: timeU as unknown as WindshieldPortalUniforms['time'],
        rainIntensity: rainU as unknown as WindshieldPortalUniforms['rainIntensity'],
        condensation: condensationU as unknown as WindshieldPortalUniforms['condensation'],
        glassAspect: aspectU as unknown as WindshieldPortalUniforms['glassAspect'],
        hdrFrame: hdrNode as unknown as WindshieldPortalUniforms['hdrFrame'],
        vibrance: road.uniforms.vibrance as unknown as WindshieldPortalUniforms['vibrance'],
        saturation: road.uniforms.saturation as unknown as WindshieldPortalUniforms['saturation'],
        contrast: road.uniforms.contrast as unknown as WindshieldPortalUniforms['contrast'],
        exposure: road.uniforms.exposure as unknown as WindshieldPortalUniforms['exposure'],
        tempMult: road.uniforms.tempMult as unknown as WindshieldPortalUniforms['tempMult'],
        nightIntensity: road.uniforms.nightIntensity as unknown as WindshieldPortalUniforms['nightIntensity'],
        roadRain: road.uniforms.roadRain as unknown as WindshieldPortalUniforms['roadRain'],
        graded: road.uniforms.graded as unknown as WindshieldPortalUniforms['graded'],
    };
    Object.defineProperty(material, 'uniforms', { value: uniforms, enumerable: true });
    return material as unknown as WindshieldPortalMaterial;
}

/**
 * A `ClippingGroup` whose planes are authored in its parent's local space and
 * re-projected to world space every time matrices update.
 *
 * three reads a clipping group's planes as **world** planes, projecting them
 * with the camera's view matrix during `_projectObject`. The cabin body rotates
 * every frame, so world planes set at build time would be stale from the second
 * tick — and refreshing them from a per-frame `update()` would still trail
 * `setCarOrientation`, which the car runtime calls *after* the interior update.
 * `updateMatrixWorld` runs inside `scene.updateMatrixWorld()`, i.e. after every
 * rotation this tick and before three projects the planes, so this is always
 * current with no ordering contract on the caller.
 */
export class WorldPlaneClippingGroup extends ClippingGroup {
    private readonly localPlanes: THREE.Plane[];

    constructor(localPlanes: THREE.Plane[]) {
        super();
        this.localPlanes = localPlanes.map((plane) => plane.clone());
        this.clippingPlanes = localPlanes.map((plane) => plane.clone());
        // Union planes: a fragment outside *any* plane is clipped, so the
        // visible region is the glass's convex aperture. Only union planes can
        // be hardware clip distances.
        this.clipIntersection = false;
        this.name = 'windshieldPortalClip';
    }

    override updateMatrixWorld(force?: boolean): void {
        super.updateMatrixWorld(force);
        for (let i = 0; i < this.localPlanes.length; i++) {
            this.clippingPlanes[i]!.copy(this.localPlanes[i]!).applyMatrix4(this.matrixWorld);
        }
    }
}
