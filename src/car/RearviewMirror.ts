import * as THREE from 'three';

/**
 * RearviewMirror - Functional rearview mirror that shows actual Street View from behind.
 * 
 * Implementation: Samples from the Street View canvas (which contains the 360° panorama)
 * and renders it to the mirror plane with:
 * - 180° rotation (shows what's behind the car)
 * - Horizontal flip (mirror reflection)
 * - Chromatic aberration for realism
 * - Frame skipping for performance (renders every 2nd frame)
 */
export class RearviewMirror {
    private mirrorCamera: THREE.PerspectiveCamera;
    private renderTarget: THREE.WebGLRenderTarget;
    private mirrorPlane: THREE.Mesh;
    private mirrorMaterial: THREE.ShaderMaterial;
    private frameCount: number = 0;
    private isNightMode: boolean = false;
    private streetViewTexture: THREE.CanvasTexture | null = null;
    private streetViewCanvas: HTMLCanvasElement | null = null;

    // Persistent resources for the mirror scene (performance optimization)
    private mirrorScreenScene: THREE.Scene;
    private mirrorScreenMesh: THREE.Mesh;
    private mirrorScreenGeo: THREE.PlaneGeometry;
    private mirrorScreenMat: THREE.MeshBasicMaterial;

    // Mirror dimensions (0.5x resolution for performance)
    private static readonly MIRROR_WIDTH = 512;
    private static readonly MIRROR_HEIGHT = 256;

    constructor(
        scene: THREE.Scene,
        private renderer: THREE.WebGLRenderer
    ) {
        // Create render target for the mirror
        this.renderTarget = new THREE.WebGLRenderTarget(
            RearviewMirror.MIRROR_WIDTH,
            RearviewMirror.MIRROR_HEIGHT,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
            }
        );

        // Create a simple scene for the mirror that contains a plane with the Street View texture
        this.mirrorCamera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
        this.mirrorCamera.position.set(0, 0, 1);

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

        // Initialize persistent resources for the mirror scene
        this.mirrorScreenScene = new THREE.Scene();
        this.mirrorScreenGeo = new THREE.PlaneGeometry(2, 1);
        this.mirrorScreenMat = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide
        });
        this.mirrorScreenMesh = new THREE.Mesh(this.mirrorScreenGeo, this.mirrorScreenMat);
        this.mirrorScreenScene.add(this.mirrorScreenMesh);
    }

    /**
     * Set the Street View canvas source for the mirror.
     * The mirror will sample from this canvas to show the view from behind.
     */
    public setStreetViewCanvas(canvas: HTMLCanvasElement | null): void {
        if (canvas === this.streetViewCanvas) return;
        
        this.streetViewCanvas = canvas;
        
        if (canvas) {
            // Create or update the texture from the Street View canvas
            if (!this.streetViewTexture) {
                this.streetViewTexture = new THREE.CanvasTexture(canvas);
                this.streetViewTexture.minFilter = THREE.LinearFilter;
                this.streetViewTexture.magFilter = THREE.LinearFilter;
                // Performance optimization: use texture transforms instead of manual UV modification
                this.streetViewTexture.wrapS = THREE.RepeatWrapping;
                this.streetViewTexture.repeat.set(-1, 1);
                this.mirrorScreenMat.map = this.streetViewTexture;
            } else {
                this.streetViewTexture.image = canvas;
                this.streetViewTexture.needsUpdate = true;
            }
        }
    }

    /**
     * Update mirror view based on car heading.
     * The mirror shows the view 180° behind the car.
     */
    public updateOrientation(_carHeading: number, _headPitch: number): void {
        // Mirror shows the view from behind the car (180° offset)
        // We don't actually rotate the camera - we just use the texture offset
        // The mirror always shows "behind" relative to car heading
    }

    /**
     * Render the mirror texture.
     * Samples from the Street View canvas and applies the mirror shader effects.
     * For performance, only updates every 2nd frame.
     * 
     * @param carHeading - Current car heading in degrees (to calculate rear view)
     * @param skipFrame - If true, only render every other frame
     */
    public update(carHeading: number, skipFrame: boolean = false): void {
        this.frameCount++;
        if (skipFrame && this.frameCount % 2 !== 0) return;

        if (!this.streetViewCanvas || !this.streetViewTexture) return;

        // Update the texture from the Street View canvas
        this.streetViewTexture.needsUpdate = true;

        // Calculate UV offset based on car heading to show what's behind
        // 180° = 0.5 in UV space (horizontal panoramic offset)
        const rearHeadingOffset = ((carHeading + 180) % 360) / 360;
        
        // Performance optimization: use texture transforms (GPU-side) instead of manual UV modification
        // Horizontal flip (1.0 - u) and offset are combined here:
        // u_transformed = u * repeat + offset
        // Since repeat.x = -1.0, u_transformed = -u + offset
        // We want (1.0 - u) + rearHeadingOffset = -u + 1.0 + rearHeadingOffset
        // So offset.x = 1.0 + rearHeadingOffset
        this.streetViewTexture.offset.x = 1.0 + rearHeadingOffset;

        // Render to the mirror's render target
        const currentTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.clear();
        this.renderer.render(this.mirrorScreenScene, this.mirrorCamera);
        this.renderer.setRenderTarget(currentTarget);
    }

    /**
     * Toggle night vision mode on the mirror.
     */
    public toggleNightMode(): void {
        this.isNightMode = !this.isNightMode;
        this.mirrorMaterial.uniforms.nightMode!.value = this.isNightMode ? 1.0 : 0.0;
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

        // Dispose of persistent rendering resources
        this.mirrorScreenGeo.dispose();
        this.mirrorScreenMat.dispose();

        if (this.streetViewTexture) {
            this.streetViewTexture.dispose();
        }
    }
}
