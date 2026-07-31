import * as THREE from 'three';

/**
 * RearviewMirror — cabin rear-view glass.
 *
 * The live Google Maps canvas is a forward-facing *perspective* Street View
 * capture, not an equirectangular pano. UV-offsetting that canvas by +180°
 * therefore cannot show what is behind the car (it just crops the forward
 * view). Until a second rear-facing Street View / Static API sample is wired
 * (billing-aware, throttled), the glass shows an honest "unavailable" state
 * rather than a fake forward crop.
 *
 * World model: the mirror mesh is parented in car-body space; head free-look
 * does not reorient it. `updateOrientation` remains a no-op by design until a
 * true rear feed exists.
 */
export class RearviewMirror {
    private mirrorPlane: THREE.Mesh;
    private mirrorMaterial: THREE.ShaderMaterial;
    private isNightMode: boolean = false;
    private rearAvailable: boolean = false;

    // Kept so a future true-rear feed can plug in without reshaping the API.
    private streetViewCanvas: HTMLCanvasElement | null = null;

    constructor(
        scene: THREE.Scene,
        private renderer: THREE.WebGLRenderer
    ) {
        // Honest unavailable glass: dark tint + soft vignette + label cue.
        // No sampling of the forward Street View canvas.
        this.mirrorMaterial = new THREE.ShaderMaterial({
            uniforms: {
                nightMode: { value: 0.0 },
                rearAvailable: { value: 0.0 },
                time: { value: 0.0 },
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

                    // When a true rear feed is eventually attached, rearAvailable
                    // flips and the glass brightens as a placeholder until textured.
                    if (rearAvailable > 0.5) {
                        glass = mix(glass, vec3(0.12, 0.13, 0.15), 0.5);
                    }

                    gl_FragColor = vec4(glass, 1.0);
                }
            `,
        });

        const mirrorGeo = new THREE.PlaneGeometry(0.28, 0.1);
        this.mirrorPlane = new THREE.Mesh(mirrorGeo, this.mirrorMaterial);
        this.mirrorPlane.position.set(0, 1.42, -0.83);
        this.mirrorPlane.rotation.set(-0.1, 0, 0);
        this.mirrorPlane.name = 'rearviewMirror';

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
     * Optionally attach a Street View canvas. The current implementation does
     * **not** sample it (forward perspective ≠ rear view). Reserved for a
     * future true-rear feed (second panorama / Static API at heading+180).
     */
    public setStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
        this.streetViewCanvas = canvas;
        // Keep unavailable until a real rear source is provided explicitly.
        if (!canvas) {
            this.setRearAvailable(false);
        }
    }

    /**
     * Mark whether a true rear-facing feed is bound. Default is false so the
     * glass stays in the honest unavailable state.
     */
    public setRearAvailable(available: boolean): void {
        this.rearAvailable = available;
        this.mirrorMaterial.uniforms.rearAvailable!.value = available ? 1.0 : 0.0;
    }

    public isRearAvailable(): boolean {
        return this.rearAvailable;
    }

    /**
     * Orientation hook for a future true-rear camera. No-op while the glass is
     * in the unavailable state — rotating a fake crop would reintroduce the bug.
     */
    public updateOrientation(_carHeading: number, _headPitch: number): void {
        // Intentionally empty until a rear-facing source exists.
    }

    /**
     * Per-frame tick. Advances the subtle frost animation; does not sample the
     * forward Street View canvas.
     */
    public update(_carHeading: number, _skipFrame: boolean = false): void {
        const u = this.mirrorMaterial.uniforms.time;
        if (u) {
            u.value = performance.now() * 0.001;
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
    public getStatus(): { rearAvailable: boolean; hasCanvas: boolean } {
        return {
            rearAvailable: this.rearAvailable,
            hasCanvas: this.streetViewCanvas !== null,
        };
    }

    public dispose(): void {
        this.mirrorMaterial.dispose();
        this.mirrorPlane.geometry.dispose();
    }
}
