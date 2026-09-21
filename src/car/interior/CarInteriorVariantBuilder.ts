import * as THREE from 'three';
import { VehicleConfig } from '../VehicleManager';
import { createCabinGlowSprite, type CabinGlowSprite } from './CabinEmitterGlow';
import { registerGlowMaterial } from './MaterialFactory';
import type { CarInteriorMaterials } from './CarInteriorBuilder';

export interface CarInteriorVariantResult {
    glowSprites: CabinGlowSprite[];
    /**
     * Auxiliary screen materials (science-lab monitors, Cortianics center HUD).
     * Driven on the center-display ramp: readable by day, brightest at night.
     */
    auxDisplayMats: THREE.MeshStandardMaterial[];
}

/**
 * Per-vehicle cabin extras — the science lab's monitors and rack, the
 * limousine's bar, the convertible's wind deflector, the Cortianics carbon
 * trim, HUD, and ambient strip.
 *
 * These are **scene plugins**: they only add meshes to the groups they are
 * handed. A variant never gets its own renderer, and screen materials go on
 * `auxDisplayMats` (center-display ramp) while pure trim goes through
 * `registerGlowMaterial` so it fades to a hint in daylight.
 */
export class CarInteriorVariantBuilder {
    constructor(
        private interiorGroup: THREE.Group,
        private materials: CarInteriorMaterials,
        private vehicleConfig: VehicleConfig,
        private quality: 'high' | 'medium' | 'low',
        private reducedMotion: boolean = false,
    ) {}

    public build(): CarInteriorVariantResult {
        switch (this.vehicleConfig.type) {
            case 'science-lab':
                return this.buildLabFeatures();
            case 'limousine':
                return this.buildLimoFeatures();
            case 'convertible':
                return this.buildConvertibleFeatures();
            case 'cortianics':
                return this.buildCortianicsFeatures();
            default:
                return { glowSprites: [], auxDisplayMats: [] };
        }
    }

    private buildLabFeatures(): CarInteriorVariantResult {
        const glowSprites: CabinGlowSprite[] = [];
        const accentHex = parseInt(this.vehicleConfig.accentColor.replace('#', '0x'));
        const monitorGeo = new THREE.BoxGeometry(0.4, 0.25, 0.05);
        const monitorMat = new THREE.MeshStandardMaterial({
            color: 0x001418,
            emissive: accentHex,
            emissiveIntensity: 0.24,
            roughness: 0.2,
        });

        const monitorPositions: Array<[number, number, number]> = [
            [0.2, 1.0, -0.72],
            [-0.2, 1.0, -0.72],
        ];
        for (const [x, y, z] of monitorPositions) {
            const monitor = new THREE.Mesh(monitorGeo, monitorMat);
            monitor.name = 'labMonitor';
            monitor.position.set(x, y, z);
            this.interiorGroup.add(monitor);

            if (this.quality !== 'low') {
                const glow = createCabinGlowSprite({
                    kind: 'cluster',
                    color: accentHex,
                    width: 0.44,
                    height: 0.28,
                    useShader: this.quality === 'high',
                    reducedMotion: this.reducedMotion,
                });
                glow.mesh.name = 'labMonitorGlow';
                // Sit on the camera-facing (+Z) face of the 0.05-deep box.
                glow.mesh.position.set(x, y, z + 0.032);
                this.interiorGroup.add(glow.mesh);
                glowSprites.push(glow);
            }
        }

        const rackGeo = new THREE.BoxGeometry(1.8, 0.6, 0.3);
        const rackMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.4,
            metalness: 0.7,
        });
        const rack = new THREE.Mesh(rackGeo, rackMat);
        rack.position.set(0, 1.0, 0.8);
        this.interiorGroup.add(rack);

        return { glowSprites, auxDisplayMats: [monitorMat] };
    }

    private buildLimoFeatures(): CarInteriorVariantResult {
        const barGeo = new THREE.BoxGeometry(0.25, 0.4, 0.6);
        const barMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.3,
            metalness: 0.5,
        });
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(0, 0.65, 0.4);
        this.interiorGroup.add(bar);

        for (let i = 0; i < 3; i++) {
            const holderGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8);
            const holderMat = new THREE.MeshStandardMaterial({
                color: 0xc0c0c0,
                roughness: 0.2,
                metalness: 0.9,
            });
            const holder = new THREE.Mesh(holderGeo, holderMat);
            holder.position.set(-0.08 + i * 0.08, 0.9, 0.5);
            this.interiorGroup.add(holder);
        }

        const dividerGeo = new THREE.BoxGeometry(1.6, 0.05, 0.02);
        const dividerMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.1,
            metalness: 0.1,
        });
        const divider = new THREE.Mesh(dividerGeo, dividerMat);
        divider.position.set(0, 1.4, 0.6);
        this.interiorGroup.add(divider);

        return { glowSprites: [], auxDisplayMats: [] };
    }

    private buildConvertibleFeatures(): CarInteriorVariantResult {
        const deflectorGeo = new THREE.BoxGeometry(1.4, 0.3, 0.02);
        const deflectorMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            transparent: true,
            opacity: 0.7,
            roughness: 0.1,
        });
        const deflector = new THREE.Mesh(deflectorGeo, deflectorMat);
        deflector.position.set(0, 1.2, 0.5);
        deflector.rotation.set(-0.2, 0, 0);
        this.interiorGroup.add(deflector);

        const sportHeadrestGeo = new THREE.BoxGeometry(0.18, 0.15, 0.06);
        const headrest = new THREE.Mesh(sportHeadrestGeo, this.materials.leather);
        headrest.position.set(-0.35, 1.3, 0.5);
        this.interiorGroup.add(headrest);

        return { glowSprites: [], auxDisplayMats: [] };
    }

    private buildCortianicsFeatures(): CarInteriorVariantResult {
        const carbonOverlayMat = new THREE.MeshPhysicalMaterial({
            color: 0x1a1c1f,
            roughness: 0.45,
            metalness: 0.18,
            clearcoat: 0.9,
            clearcoatRoughness: 0.2,
        });
        const leftOverlay = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.78, 0.04), carbonOverlayMat);
        leftOverlay.position.set(-0.905, 1.32, -0.84);
        leftOverlay.rotation.set(-0.2, 0, -0.1);
        this.interiorGroup.add(leftOverlay);

        const rightOverlay = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.78, 0.04), carbonOverlayMat);
        rightOverlay.position.set(0.905, 1.32, -0.84);
        rightOverlay.rotation.set(-0.2, 0, 0.1);
        this.interiorGroup.add(rightOverlay);

        // Screen, not trim: keep a daylight floor and let the center-display
        // ramp take it to full brightness at night.
        const hudMat = new THREE.MeshStandardMaterial({
            color: 0x10151c,
            emissive: 0x5a7f8a,
            emissiveIntensity: 0.24,
            roughness: 0.28,
            metalness: 0.62,
        });
        const hud = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.085, 0.045), hudMat);
        hud.name = 'CortianicsCenterHud';
        hud.position.set(0.18, 0.995, -0.74);
        this.interiorGroup.add(hud);

        // Accent trim: joins the cabin glow registry so the red strip fades to a
        // hint in daylight instead of holding a night wash under full sun.
        const ambientStripMat = new THREE.MeshStandardMaterial({
            color: 0x55120f,
            emissive: 0xdc201c,
            emissiveIntensity: 0,
            roughness: 0.35,
            metalness: 0.2,
        });
        registerGlowMaterial(ambientStripMat, 0.45);
        const ambientStrip = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.018, 0.02), ambientStripMat);
        ambientStrip.name = 'CortianicsAmbientStrip';
        ambientStrip.position.set(0.18, 0.93, -0.76);
        this.interiorGroup.add(ambientStrip);

        const clusterGlow = createCabinGlowSprite({
            kind: 'cluster',
            color: 0xdc201c,
            width: 1.4,
            height: 0.08,
            useShader: this.quality === 'high',
            reducedMotion: this.reducedMotion,
        });
        clusterGlow.mesh.position.set(0.18, 0.94, -0.755);
        this.interiorGroup.add(clusterGlow.mesh);

        return { glowSprites: [clusterGlow], auxDisplayMats: [hudMat] };
    }
}
