import * as THREE from 'three';
import { getMemoryProfiler, MemoryProfiler } from '../../utils/memoryProfiler';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import type { PanoEnvironment } from './PanoEnvironment';
import type { PostProcessingManager } from './PostProcessingManager';
import type { RainSystem } from './RainSystem';
import type { DustMoteSystem } from './DustMoteSystem';
import type { WindowWeatherOverlay } from './WindowWeatherOverlay';
import type { VanityMirror } from './VanityMirror';
import type { LocationPanel } from './LocationPanel';
import type { CabinRenderer } from './createCabinRenderer';

export interface CarInteriorDisposeHost {
    animationId: number;
    clockUpdateInterval?: number;
    renderer: CabinRenderer;
    scene: THREE.Scene;
    canvas: HTMLCanvasElement;
    panoEnvironment: PanoEnvironment;
    locationPanel: LocationPanel | null;
    detailMeshes: THREE.Mesh[];
    lodUpdateFn?: () => void;
    geometryFactory: GeometryFactory;
    lodManager: LODManager;
    postProcessing?: PostProcessingManager;
    rainSystem?: RainSystem;
    dustMoteSystem?: DustMoteSystem;
    windowWeatherOverlay?: WindowWeatherOverlay;
    vanityMirror?: VanityMirror;
}

function disposeMaterialTextures(material: THREE.Material): void {
    const mat = material as THREE.MeshStandardMaterial & Record<string, THREE.Texture | undefined>;
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']
        .forEach(prop => {
            if (mat[prop]) {
                mat[prop]!.dispose();
                mat[prop] = undefined;
            }
        });
}

export function disposeCarInteriorResources(host: CarInteriorDisposeHost): void {
    cancelAnimationFrame(host.animationId);

    if (host.clockUpdateInterval !== undefined) {
        clearInterval(host.clockUpdateInterval);
        host.clockUpdateInterval = undefined;
    }

    const memoryProfiler = getMemoryProfiler();
    const stats = memoryProfiler.getStats();
    console.log('[CarInterior] Disposing - memory stats:', {
        geometries: stats.current.geometryCount,
        textures: stats.current.textureCount,
        memory: MemoryProfiler.formatBytes(stats.current.estimatedBytes),
    });

    host.renderer.dispose();
    host.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => {
                    disposeMaterialTextures(m);
                    m.dispose();
                });
            } else {
                disposeMaterialTextures(obj.material);
                obj.material.dispose();
            }
        }
    });

    host.panoEnvironment.dispose();

    host.locationPanel = null;
    host.detailMeshes.length = 0;
    host.lodUpdateFn = undefined;
    host.geometryFactory.dispose();
    host.lodManager.dispose();
    if (host.postProcessing) host.postProcessing.dispose();
    if (host.rainSystem) host.rainSystem.dispose();
    host.dustMoteSystem?.dispose();
    host.windowWeatherOverlay?.dispose();
    host.vanityMirror?.dispose();

    if (host.canvas.parentElement) {
        host.canvas.parentElement.removeChild(host.canvas);
    }
}
