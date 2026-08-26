import * as THREE from 'three';
import type { RearViewSample } from './rearViewFeed';
import { signedHeadingDelta } from './rearViewFeed';
import type { CabinRenderer } from './interior/createCabinRenderer';

/**
 * Duplicated from `createCabinRenderer.ts`'s `isWebGPUCabinRenderer` rather
 * than imported — see the identical note in `interior/VanityMirror.ts` for
 * why (importing it here changes Rollup's automatic chunking of this module
 * graph and leaks `three` into the eager main bundle). No dependencies of
 * its own, so a local copy is cheap insurance.
 */
function isWebGPUCabinRenderer(renderer: CabinRenderer): boolean {
    return (renderer as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
}

/**
 * RearviewMirror — cabin rear-view glass.
 *
 * The live Google Maps canvas is a forward-facing *perspective* Street View
 * capture, not an equirectangular pano. UV-offsetting that canvas by +180°
 * therefore cannot show what is behind the car (it just crops the forward
 * view), so the forward canvas is never sampled here.
 *
 * A **true** rear feed comes from `rearViewFeed.ts`: a throttled, budgeted
 * Street View Static API sample taken at `carHeading + 180`. When one is bound
 * via `setRearSample()`, the glass shows that imagery, horizontally flipped the
 * way a real mirror is. With no sample bound — feature off, offline, Low
 * quality, no key, or no imagery at this pano — the glass falls back to an
 * honest "unavailable" state rather than a fake forward crop.
 *
 * Because a Static sample is a still taken at one instant, `updateOrientation()`
 * re-registers it as the car turns: the UV pan compensates for the heading
 * delta since capture, and the imagery fades out once the car has rotated past
 * what the sample's FOV can cover. That is registration of real imagery, not an
 * invented crop.
 *
 * World model: the mirror mesh is parented in car-body space; head free-look
 * does not reorient it (head pitch is deliberately ignored).
 */
export class RearviewMirror {
    private mirrorPlane: THREE.Mesh;
    /** The shader-driven glass. Uniform state is always kept up to date (see below) even when `activeMaterial` is showing something else. */
    private mirrorMaterial: THREE.ShaderMaterial;
    /** What the mirror meshes actually display: `mirrorMaterial` on WebGL, or a plain flat fallback on WebGPU — `ShaderMaterial`'s raw GLSL has no TSL/NodeMaterial equivalent there yet. */
    private readonly activeMaterial: THREE.Material;
    private isNightMode: boolean = false;
    private rearAvailable: boolean = false;

    // Retained for API parity only — the forward canvas is never sampled.
    private streetViewCanvas: HTMLCanvasElement | null = null;

    /** Currently bound true-rear Static sample, if any. */
    private rearSample: RearViewSample | null = null;
    private rearTexture: THREE.Texture | null = null;
    /** Signed car-heading rotation since the bound sample was captured. */
    private headingDeltaDeg: number = 0;

    constructor(
        scene: THREE.Scene,
        private renderer: CabinRenderer
    ) {
        // Honest unavailable glass: dark tint + soft vignette + label cue.
        // No sampling of the forward Street View canvas.
        this.mirrorMaterial = new THREE.ShaderMaterial({
            uniforms: {
                nightMode: { value: 0.0 },
                rearAvailable: { value: 0.0 },
                time: { value: 0.0 },
                // True-rear Static sample, horizontally flipped at sample time.
                rearTex: { value: null },
                // UV pan (in texture units) compensating car rotation since capture.
                rearPan: { value: 0.0 },
                // 0..1 confidence — decays as the car rotates out of the sample's FOV.
                rearFade: { value: 0.0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float nightMode;
                uniform float rearAvailable;
                uniform float time;
                uniform sampler2D rearTex;
                uniform float rearPan;
                uniform float rearFade;
                varying vec2 vUv;

                void main() {
                    // Base glass — cool dark mirror when rear feed is unavailable.
                    vec3 glass = vec3(0.06, 0.07, 0.09);
                    if (nightMode > 0.5) {
                        glass = vec3(0.03, 0.06, 0.04);
                    }

                    // Soft edge vignette so it still reads as a mirror bezel.
                    float dist = distance(vUv, vec2(0.5));
                    float vignette = 1.0 - smoothstep(0.25, 0.72, dist);
                    glass *= mix(0.55, 1.0, vignette);

                    // Subtle horizontal scan / frost so the glass does not look broken-black.
                    float frost = 0.02 + 0.015 * sin(vUv.y * 40.0 + time * 0.4);
                    glass += vec3(frost);

                    // Center band label cue ("no rear feed") via luminance dip.
                    // Readable as a dim horizontal readout without textured fonts.
                    float band = smoothstep(0.42, 0.48, vUv.y) * (1.0 - smoothstep(0.52, 0.58, vUv.y));
                    float bandX = smoothstep(0.18, 0.28, vUv.x) * (1.0 - smoothstep(0.72, 0.82, vUv.x));
                    float label = band * bandX;
                    vec3 labelColor = nightMode > 0.5
                        ? vec3(0.15, 0.45, 0.18)
                        : vec3(0.35, 0.38, 0.42);
                    glass = mix(glass, labelColor, label * 0.85);

                    // True-rear Static sample. A real mirror reverses left/right,
                    // hence the 1.0 - x; rearPan re-registers the still against how
                    // far the car has turned since it was captured.
                    if (rearAvailable > 0.5) {
                        vec2 rearUv = vec2(1.0 - vUv.x + rearPan, vUv.y);

                        // Outside the sample's coverage there is no honest imagery
                        // to show, so let the unavailable glass through instead of
                        // smearing clamped edge texels.
                        vec2 inside = step(vec2(0.0), rearUv) * step(rearUv, vec2(1.0));
                        float coverage = inside.x * inside.y;

                        vec3 rear = texture2D(rearTex, clamp(rearUv, 0.0, 1.0)).rgb;
                        // Mirror glass: slightly dimmed, much dimmer at night.
                        rear *= mix(0.92, 0.42, nightMode);
                        rear *= mix(0.6, 1.0, vignette);

                        glass = mix(glass, rear, clamp(rearFade, 0.0, 1.0) * coverage);
                    }

                    gl_FragColor = vec4(glass, 1.0);
                }
            `,
        });

        this.activeMaterial = isWebGPUCabinRenderer(renderer)
            ? new THREE.MeshBasicMaterial({ color: 0x0f1116 })
            : this.mirrorMaterial;

        const mirrorGeo = new THREE.PlaneGeometry(0.28, 0.1);
        this.mirrorPlane = new THREE.Mesh(mirrorGeo, this.activeMaterial);
        this.mirrorPlane.position.set(0, 1.42, -0.83);
        this.mirrorPlane.rotation.set(-0.1, 0, 0);
        this.mirrorPlane.name = 'RearviewGlass';

        const frameGeo = new THREE.BoxGeometry(0.32, 0.14, 0.02);
        const frameMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.5,
            metalness: 0.7,
        });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set(0, 1.42, -0.84);
        frame.rotation.set(-0.1, 0, 0);
        frame.name = 'rearviewMirrorFrame';

        scene.add(frame);
        scene.add(this.mirrorPlane);

        // Renderer kept for API parity with a future rear-facing RT path.
        void this.renderer;
    }

    /**
     * Side glasses follow the interior rearview rule: honest unavailable by
     * default, and the same billing-gated Static sample when one is bound.
     * Never UV-crop the forward panorama. Sharing `mirrorMaterial` means one
     * sample, not three requests.
     */
    public attachSideGlasses(left?: THREE.Mesh | null, right?: THREE.Mesh | null): void {
        if (left) {
            left.name = 'SideMirrorL';
            left.material = this.activeMaterial;
        }
        if (right) {
            right.name = 'SideMirrorR';
            right.material = this.activeMaterial;
        }
    }

    /**
     * Attach the forward Street View canvas. The mirror does **not** sample it
     * (forward perspective ≠ rear view); the hook exists so callers that track
     * the scraped canvas keep a single place to notify. Detaching it does not
     * disturb a bound rear sample, which comes from a separate source.
     */
    public setStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
        this.streetViewCanvas = canvas;
    }

    /**
     * Bind (or clear) a true rear-facing Static API sample. Passing null returns
     * the glass to the honest unavailable state and releases the GPU texture.
     */
    public setRearSample(sample: RearViewSample | null): void {
        if (sample === this.rearSample) return;

        this.releaseRearTexture();
        this.rearSample = sample;

        if (!sample) {
            this.headingDeltaDeg = 0;
            this.applyRearRegistration();
            this.setRearAvailable(false);
            return;
        }

        const texture = new THREE.Texture(sample.image as TexImageSource);
        // Static samples are non-power-of-two and never tiled — clamp + linear.
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        this.rearTexture = texture;
        this.mirrorMaterial.uniforms.rearTex!.value = texture;
        this.headingDeltaDeg = 0;
        this.applyRearRegistration();
        this.setRearAvailable(true);
    }

    /**
     * Mark whether a true rear-facing feed is bound. Default is false so the
     * glass stays in the honest unavailable state. Marking available without a
     * bound sample is refused — an "available" mirror with nothing to show would
     * render clamped garbage rather than an honest unavailable state.
     */
    public setRearAvailable(available: boolean): void {
        const effective = available && this.rearTexture !== null;
        this.rearAvailable = effective;
        this.mirrorMaterial.uniforms.rearAvailable!.value = effective ? 1.0 : 0.0;
    }

    public isRearAvailable(): boolean {
        return this.rearAvailable;
    }

    /**
     * Re-register the bound rear sample against the car's current heading.
     *
     * The sample is a still taken at one instant. As the car turns, the world it
     * captured slides across the glass; panning the UVs by the heading delta
     * over the sample FOV keeps it lined up. Head pitch is ignored on purpose —
     * the mirror lives in car-body space, so free-look must not move it.
     *
     * No-op with no sample bound: rotating an absent feed is exactly the fake
     * crop this class exists to avoid.
     */
    public updateOrientation(carHeading: number, _headPitch: number): void {
        if (!this.rearSample) return;
        this.headingDeltaDeg = signedHeadingDelta(carHeading, this.rearSample.carHeading);
        this.applyRearRegistration();
    }

    /** Push `headingDeltaDeg` into the pan/fade uniforms. */
    private applyRearRegistration(): void {
        const sample = this.rearSample;
        const uniforms = this.mirrorMaterial.uniforms;

        if (!sample) {
            uniforms.rearPan!.value = 0;
            uniforms.rearFade!.value = 0;
            return;
        }

        const fov = sample.fov > 0 ? sample.fov : 90;
        uniforms.rearPan!.value = this.headingDeltaDeg / fov;

        // Full confidence while the car is still inside the captured cone; fade
        // to nothing by the time it has turned a full FOV away.
        const turned = Math.abs(this.headingDeltaDeg);
        const fadeStart = fov * 0.35;
        const fadeEnd = fov;
        const fade =
            turned <= fadeStart
                ? 1
                : turned >= fadeEnd
                  ? 0
                  : 1 - (turned - fadeStart) / (fadeEnd - fadeStart);
        uniforms.rearFade!.value = fade;
    }

    private releaseRearTexture(): void {
        if (this.rearTexture) {
            this.rearTexture.dispose();
            this.rearTexture = null;
        }
        this.mirrorMaterial.uniforms.rearTex!.value = null;
    }

    /**
     * Per-frame tick. Advances the frost animation and keeps a bound rear sample
     * registered against the live car heading. Never samples the forward canvas.
     */
    public update(carHeading: number, _skipFrame: boolean = false): void {
        const u = this.mirrorMaterial.uniforms.time;
        if (u) {
            u.value = performance.now() * 0.001;
        }
        if (this.rearSample) {
            this.updateOrientation(carHeading, 0);
        }
    }

    public toggleNightMode(): void {
        this.isNightMode = !this.isNightMode;
        this.mirrorMaterial.uniforms.nightMode!.value = this.isNightMode ? 1.0 : 0.0;
    }

    public getMirrorMesh(): THREE.Mesh {
        return this.mirrorPlane;
    }

    /** Test/diagnostic: whether the glass is currently sampling a rear feed. */
    public getStatus(): {
        rearAvailable: boolean;
        hasCanvas: boolean;
        hasRearSample: boolean;
        headingDeltaDeg: number;
        rearPan: number;
        rearFade: number;
    } {
        return {
            rearAvailable: this.rearAvailable,
            hasCanvas: this.streetViewCanvas !== null,
            hasRearSample: this.rearSample !== null,
            headingDeltaDeg: this.headingDeltaDeg,
            rearPan: this.mirrorMaterial.uniforms.rearPan!.value as number,
            rearFade: this.mirrorMaterial.uniforms.rearFade!.value as number,
        };
    }

    public dispose(): void {
        this.releaseRearTexture();
        this.rearSample = null;
        this.mirrorMaterial.dispose();
        if (this.activeMaterial !== this.mirrorMaterial) this.activeMaterial.dispose();
        this.mirrorPlane.geometry.dispose();
    }
}
