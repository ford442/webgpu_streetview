import * as THREE from 'three';

/**
 * CarInterior - Manages the 3D car interior shell, materials, and roof animation.
 * Uses Three.js primitives to create a low-poly convertible interior from the driver seat perspective.
 * Renders as an overlay with transparent background so the Street View panorama shows through windows.
 */
export class CarInterior {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public canvas: HTMLCanvasElement;

    private interiorGroup: THREE.Group;
    private roofGroup: THREE.Group;
    private isRoofOpen: boolean = false;
    private roofTargetY: number = 0;
    private animationId: number = 0;

    // Materials
    private dashboardMaterial!: THREE.MeshStandardMaterial;
    private leatherMaterial!: THREE.MeshStandardMaterial;
    private metalMaterial!: THREE.MeshStandardMaterial;
    private frameMaterial!: THREE.MeshStandardMaterial;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();

        // Camera at driver seat eye level (~1.2m), slightly angled toward center console
        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.01, 100);
        this.camera.position.set(-0.3, 1.2, 0.0);
        this.camera.rotation.set(0, 0, 0);

        // Renderer with alpha for transparency (Street View shows through)
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.autoClear = false;
        this.canvas = this.renderer.domElement;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '5';
        container.appendChild(this.canvas);

        this.interiorGroup = new THREE.Group();
        this.roofGroup = new THREE.Group();
        this.scene.add(this.interiorGroup);
        this.scene.add(this.roofGroup);

        this.createMaterials();
        this.createLighting();
        this.buildInterior();
    }

    private createMaterials(): void {
        // Generate procedural noise texture via canvas for leather roughness
        const leatherCanvas = document.createElement('canvas');
        leatherCanvas.width = 128;
        leatherCanvas.height = 128;
        const ctx = leatherCanvas.getContext('2d')!;
        for (let y = 0; y < 128; y++) {
            for (let x = 0; x < 128; x++) {
                const v = Math.random() * 30 + 40;
                ctx.fillStyle = `rgb(${v}, ${v * 0.8}, ${v * 0.6})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        const leatherTexture = new THREE.CanvasTexture(leatherCanvas);
        leatherTexture.wrapS = THREE.RepeatWrapping;
        leatherTexture.wrapT = THREE.RepeatWrapping;

        // Dashboard plastic material
        this.dashboardMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.8,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });

        // Leather material for seats
        this.leatherMaterial = new THREE.MeshStandardMaterial({
            map: leatherTexture,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        // Metal material for steering column, trim
        this.metalMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.3,
            metalness: 0.8,
            side: THREE.DoubleSide,
        });

        // Frame material for door panels, pillars
        this.frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });
    }

    private createLighting(): void {
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        const dashLight = new THREE.PointLight(0x4CAF50, 0.3, 3);
        dashLight.position.set(0, 0.9, -0.8);
        this.scene.add(dashLight);

        const overhead = new THREE.DirectionalLight(0xffffff, 0.6);
        overhead.position.set(0, 3, 0);
        this.scene.add(overhead);
    }

    private buildInterior(): void {
        this.buildDashboard();
        this.buildSteeringWheel();
        this.buildDoorPanels();
        this.buildSeats();
        this.buildFloor();
        this.buildRoof();
        this.buildWindshieldFrame();
    }

    private buildDashboard(): void {
        // Main dashboard body
        const dashGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
        const dash = new THREE.Mesh(dashGeo, this.dashboardMaterial);
        dash.position.set(0, 0.8, -1.0);
        this.interiorGroup.add(dash);

        // Dashboard top curve (slightly beveled)
        const dashTopGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8, 1, false, 0, Math.PI);
        const dashTop = new THREE.Mesh(dashTopGeo, this.dashboardMaterial);
        dashTop.rotation.set(0, 0, Math.PI / 2);
        dashTop.position.set(0, 1.0, -0.85);
        this.interiorGroup.add(dashTop);

        // Instrument cluster recess
        const clusterGeo = new THREE.BoxGeometry(0.6, 0.25, 0.05);
        const clusterMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x001100, emissiveIntensity: 0.5 });
        const cluster = new THREE.Mesh(clusterGeo, clusterMat);
        cluster.position.set(-0.3, 0.95, -0.74);
        this.interiorGroup.add(cluster);

        // Center console display
        const displayGeo = new THREE.BoxGeometry(0.3, 0.2, 0.02);
        const displayMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x002200, emissiveIntensity: 0.3 });
        const display = new THREE.Mesh(displayGeo, displayMat);
        display.position.set(0.15, 0.95, -0.74);
        this.interiorGroup.add(display);
    }

    private buildSteeringWheel(): void {
        // Steering wheel rim (torus)
        const wheelGeo = new THREE.TorusGeometry(0.18, 0.02, 8, 24);
        const wheel = new THREE.Mesh(wheelGeo, this.frameMaterial);
        wheel.position.set(-0.35, 0.95, -0.6);
        wheel.rotation.set(Math.PI * 0.35, 0, 0);
        this.interiorGroup.add(wheel);

        // Steering column
        const columnGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8);
        const column = new THREE.Mesh(columnGeo, this.metalMaterial);
        column.position.set(-0.35, 0.78, -0.7);
        column.rotation.set(Math.PI * 0.35, 0, 0);
        this.interiorGroup.add(column);

        // Steering wheel center hub
        const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16);
        const hub = new THREE.Mesh(hubGeo, this.dashboardMaterial);
        hub.position.set(-0.35, 0.95, -0.6);
        hub.rotation.set(Math.PI * 0.35, 0, 0);
        this.interiorGroup.add(hub);

        // Spokes (3 spokes)
        for (let i = 0; i < 3; i++) {
            const spokeGeo = new THREE.BoxGeometry(0.015, 0.16, 0.015);
            const spoke = new THREE.Mesh(spokeGeo, this.metalMaterial);
            spoke.position.set(-0.35, 0.95, -0.6);
            const angle = (i * Math.PI * 2) / 3;
            spoke.rotation.set(Math.PI * 0.35, 0, angle);
            this.interiorGroup.add(spoke);
        }
    }

    private buildDoorPanels(): void {
        // Left door panel (driver side)
        const leftDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const leftDoor = new THREE.Mesh(leftDoorGeo, this.frameMaterial);
        leftDoor.position.set(-1.0, 0.7, 0.0);
        this.interiorGroup.add(leftDoor);

        // Left door armrest
        const leftArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const leftArm = new THREE.Mesh(leftArmGeo, this.leatherMaterial);
        leftArm.position.set(-0.96, 0.85, 0.1);
        this.interiorGroup.add(leftArm);

        // Right door panel (passenger side)
        const rightDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const rightDoor = new THREE.Mesh(rightDoorGeo, this.frameMaterial);
        rightDoor.position.set(1.0, 0.7, 0.0);
        this.interiorGroup.add(rightDoor);

        // Right door armrest
        const rightArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const rightArm = new THREE.Mesh(rightArmGeo, this.leatherMaterial);
        rightArm.position.set(0.96, 0.85, 0.1);
        this.interiorGroup.add(rightArm);

        // Center console between seats
        const consoleGeo = new THREE.BoxGeometry(0.3, 0.35, 0.8);
        const consoleMesh = new THREE.Mesh(consoleGeo, this.dashboardMaterial);
        consoleMesh.position.set(0.0, 0.55, 0.3);
        this.interiorGroup.add(consoleMesh);
    }

    private buildSeats(): void {
        // Driver seat back
        const seatBackGeo = new THREE.BoxGeometry(0.5, 0.7, 0.12);
        const seatBack = new THREE.Mesh(seatBackGeo, this.leatherMaterial);
        seatBack.position.set(-0.35, 0.9, 0.5);
        seatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(seatBack);

        // Driver seat bottom
        const seatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
        const seatBottom = new THREE.Mesh(seatBottomGeo, this.leatherMaterial);
        seatBottom.position.set(-0.35, 0.5, 0.2);
        this.interiorGroup.add(seatBottom);

        // Passenger seat back
        const passSeatBackGeo = new THREE.BoxGeometry(0.5, 0.7, 0.12);
        const passSeatBack = new THREE.Mesh(passSeatBackGeo, this.leatherMaterial);
        passSeatBack.position.set(0.45, 0.9, 0.5);
        passSeatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(passSeatBack);

        // Passenger seat bottom
        const passSeatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
        const passSeatBottom = new THREE.Mesh(passSeatBottomGeo, this.leatherMaterial);
        passSeatBottom.position.set(0.45, 0.5, 0.2);
        this.interiorGroup.add(passSeatBottom);

        // Headrest driver
        const headrestGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);
        const headrest = new THREE.Mesh(headrestGeo, this.leatherMaterial);
        headrest.position.set(-0.35, 1.35, 0.5);
        this.interiorGroup.add(headrest);

        // Headrest passenger
        const headrestPassGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);
        const headrestPass = new THREE.Mesh(headrestPassGeo, this.leatherMaterial);
        headrestPass.position.set(0.45, 1.35, 0.5);
        this.interiorGroup.add(headrestPass);
    }

    private buildFloor(): void {
        const floorGeo = new THREE.PlaneGeometry(2.0, 2.5);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.95,
            side: THREE.DoubleSide,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0);
        this.interiorGroup.add(floor);
    }

    private buildRoof(): void {
        // Convertible roof - can be toggled open/closed
        const roofGeo = new THREE.BoxGeometry(2.0, 0.05, 2.0);
        const roofMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.9,
            side: THREE.DoubleSide,
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, 1.6, 0);
        this.roofGroup.add(roof);
    }

    private buildWindshieldFrame(): void {
        // A-pillars (windshield frame)
        const pillarGeo = new THREE.BoxGeometry(0.06, 0.8, 0.06);

        // Left A-pillar
        const leftPillar = new THREE.Mesh(pillarGeo, this.frameMaterial);
        leftPillar.position.set(-0.95, 1.3, -0.85);
        leftPillar.rotation.set(-0.2, 0, -0.1);
        this.interiorGroup.add(leftPillar);

        // Right A-pillar
        const rightPillar = new THREE.Mesh(pillarGeo, this.frameMaterial);
        rightPillar.position.set(0.95, 1.3, -0.85);
        rightPillar.rotation.set(-0.2, 0, 0.1);
        this.interiorGroup.add(rightPillar);

        // Windshield top bar
        const topBarGeo = new THREE.BoxGeometry(1.95, 0.06, 0.06);
        const topBar = new THREE.Mesh(topBarGeo, this.frameMaterial);
        topBar.position.set(0, 1.6, -0.9);
        this.interiorGroup.add(topBar);

        // Rearview mirror mount (small bar on windshield top)
        const mirrorMountGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6);
        const mirrorMount = new THREE.Mesh(mirrorMountGeo, this.metalMaterial);
        mirrorMount.position.set(0, 1.5, -0.85);
        this.interiorGroup.add(mirrorMount);
    }

    /**
     * Toggle the convertible roof open/closed.
     * Animates the roof geometry to slide down through the floor.
     */
    public toggleRoof(): void {
        this.isRoofOpen = !this.isRoofOpen;
        this.roofTargetY = this.isRoofOpen ? -1.0 : 1.6;
    }

    /**
     * Update loop - call each frame to animate roof and other dynamic elements.
     */
    public update(deltaTime: number): void {
        // Animate roof position (lerp)
        const currentY = this.roofGroup.position.y;
        const targetY = this.roofTargetY;
        const diff = targetY - currentY;
        if (Math.abs(diff) > 0.001) {
            this.roofGroup.position.y += diff * Math.min(deltaTime * 3, 1);
        }
    }

    /**
     * Render the car interior scene.
     */
    public render(): void {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Handle window resize.
     */
    public resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Clean up resources.
     */
    public dispose(): void {
        cancelAnimationFrame(this.animationId);
        this.renderer.dispose();
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        if (this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
    }
}
