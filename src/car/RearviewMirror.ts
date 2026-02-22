import * as THREE from 'three';

/**
 * RearviewMirror - Handles render-to-texture logic for the rearview mirror.
 * Creates a second camera facing backward (180° from driver view) and renders
 * the Street View panorama to a texture applied to a mirror plane.
 * Includes chromatic aberration for realistic mirror distortion.
 */
export class RearviewMirror {
    private mirrorCamera: THREE.PerspectiveCamera;
    private renderTarget: THREE.WebGLRenderTarget;
    private mirrorPlane: THREE.Mesh;
    private mirrorMaterial: THREE.ShaderMaterial;
    private frameCount: number = 0;
    private isNightMode: boolean = false;

    // Mirror dimensions (0.5x resolution for performance)
    private static readonly MIRROR_WIDTH = 512;
    private static readonly MIRROR_HEIGHT = 256;

    constructor(
        private scene: THREE.Scene,
        private renderer: THREE.WebGLRenderer
    ) {
        // Backward-facing camera (180° from driver view)
        this.mirrorCamera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
        this.mirrorCamera.position.set(0, 1.45, -0.85);
        this.mirrorCamera.rotation.set(0, Math.PI, 0);

        // Render target at 0.5x resolution
        this.renderTarget = new THREE.WebGLRenderTarget(
            RearviewMirror.MIRROR_WIDTH,
            RearviewMirror.MIRROR_HEIGHT,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
            }
        );

        // Chromatic aberration shader material for mirror
        this.mirrorMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: this.renderTarget.texture },
                aberrationStrength: { value: 0.003 },
                nightMode: { value: 0.0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float aberrationStrength;
                uniform float nightMode;
                varying vec2 vUv;
                
                void main() {
                    vec2 uv = vUv;
                    // Mirror (flip horizontally for correct mirror reflection)
                    uv.x = 1.0 - uv.x;
                    
                    // Chromatic aberration
                    float r = texture2D(tDiffuse, uv + vec2(aberrationStrength, 0.0)).r;
                    float g = texture2D(tDiffuse, uv).g;
                    float b = texture2D(tDiffuse, uv - vec2(aberrationStrength, 0.0)).b;
                    
                    vec3 color = vec3(r, g, b);
                    
                    // Night mode: green tint like night vision
                    if (nightMode > 0.5) {
                        float luminance = dot(color, vec3(0.299, 0.587, 0.114));
                        color = vec3(luminance * 0.3, luminance * 1.2, luminance * 0.3);
                    }
                    
                    // Slight vignette on mirror edges
                    float dist = distance(vUv, vec2(0.5));
                    float vignette = 1.0 - smoothstep(0.3, 0.7, dist);
                    color *= mix(0.7, 1.0, vignette);
                    
                    // Mirror tint (slightly blue/grey)
                    color = mix(color, color * vec3(0.85, 0.9, 1.0), 0.3);
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });

        // Mirror plane geometry positioned at rearview mirror location
        const mirrorGeo = new THREE.PlaneGeometry(0.28, 0.1);
        this.mirrorPlane = new THREE.Mesh(mirrorGeo, this.mirrorMaterial);
        this.mirrorPlane.position.set(0, 1.42, -0.83);
        this.mirrorPlane.rotation.set(-0.1, 0, 0);

        // Mirror frame
        const frameGeo = new THREE.BoxGeometry(0.32, 0.14, 0.02);
        const frameMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.5,
            metalness: 0.7,
        });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set(0, 1.42, -0.84);
        frame.rotation.set(-0.1, 0, 0);

        scene.add(frame);
        scene.add(this.mirrorPlane);
    }

    /**
     * Update mirror camera rotation based on driver head orientation.
     * The mirror shows the backward view (inverted for mirror logic).
     */
    public updateOrientation(heading: number, pitch: number): void {
        // Mirror faces backward (180° offset) with inverted horizontal
        const headingRad = (heading + 180) * Math.PI / 180;
        const pitchRad = -pitch * Math.PI / 180 * 0.3; // Reduced pitch influence

        this.mirrorCamera.rotation.set(pitchRad, headingRad, 0);
    }

    /**
     * Render the mirror texture. For performance, only updates every 2nd frame
     * if performance is a concern.
     * @param panoramaScene - The scene containing the Street View panorama
     * @param skipFrame - If true, only render every other frame
     */
    public update(panoramaScene: THREE.Scene | null, skipFrame: boolean = false): void {
        this.frameCount++;
        if (skipFrame && this.frameCount % 2 !== 0) return;

        if (!panoramaScene) return;

        // Render backward view to render target
        const currentTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.clear();
        this.renderer.render(panoramaScene, this.mirrorCamera);
        this.renderer.setRenderTarget(currentTarget);
    }

    /**
     * Toggle night vision mode on the mirror.
     */
    public toggleNightMode(): void {
        this.isNightMode = !this.isNightMode;
        this.mirrorMaterial.uniforms.nightMode.value = this.isNightMode ? 1.0 : 0.0;
    }

    /**
     * Get the mirror plane mesh for raycasting/click detection.
     */
    public getMirrorMesh(): THREE.Mesh {
        return this.mirrorPlane;
    }

    /**
     * Clean up resources.
     */
    public dispose(): void {
        this.renderTarget.dispose();
        this.mirrorMaterial.dispose();
        this.mirrorPlane.geometry.dispose();
    }
}
