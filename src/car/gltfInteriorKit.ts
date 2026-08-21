/**
 * Optional glTF interior kit.
 *
 * Enable with `?gltfInterior=1` (persists to localStorage) or the Ultra-quality
 * user toggle. Cabins stay procedural by default so `scripts/check-bundle-budget.sh`
 * stays green — GLTFLoader is dynamic-imported only from this module, never
 * from bootstrap on the default path.
 *
 * Draco / meshopt stay out until a hero mesh actually needs them (the sedan
 * cabin is an uncompressed GLB).
 */

import * as THREE from 'three';
import {
  GLTF_INTERIOR_ASSET,
  GLTF_INTERIOR_SOCKETS,
  GLTF_INTERIOR_STORAGE_KEY,
  type GltfInteriorSocket,
} from './gltfSockets';
import type { WindowWeatherOverlay } from './interior/WindowWeatherOverlay';
import type { GaugeRig } from './interior/CarInteriorGauges';

export { GLTF_INTERIOR_ASSET, GLTF_INTERIOR_SOCKETS, GLTF_INTERIOR_STORAGE_KEY };
export type { GltfInteriorSocket };

export function isGltfInteriorEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('gltfInterior') === '1') {
      try {
        window.localStorage.setItem(GLTF_INTERIOR_STORAGE_KEY, '1');
      } catch {
        /* ignore quota */
      }
      return true;
    }
  } catch {
    /* ignore malformed search */
  }
  try {
    return window.localStorage.getItem(GLTF_INTERIOR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setGltfInteriorEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(GLTF_INTERIOR_STORAGE_KEY, '1');
    else window.localStorage.removeItem(GLTF_INTERIOR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export interface GltfInteriorKit {
  GLTFLoader: new () => {
    loadAsync: (url: string) => Promise<{ scene: THREE.Group }>;
  };
}

/**
 * Host surface applyGltfInterior mutates. Matches the CarInterior assembly
 * fields the animator / overlay / mirrors already read.
 */
export interface GltfInteriorHost {
  interiorGroup: THREE.Group;
  vehicleType?: string;
  steeringWheelGroup: THREE.Group;
  wiperLeft: THREE.Group;
  wiperRight: THREE.Group;
  speedometerNeedle: THREE.Mesh;
  tachometerNeedle: THREE.Mesh;
  windshieldGlassMesh: THREE.Mesh;
  rearGlassMesh?: THREE.Mesh;
  leftMirrorPlane?: THREE.Mesh;
  rightMirrorPlane?: THREE.Mesh;
  windowWeatherOverlay?: WindowWeatherOverlay;
  gaugeRig?: GaugeRig | null;
  proceduralCabinGroup?: THREE.Group;
  gltfCabinGroup?: THREE.Group;
  gltfInteriorApplied?: boolean;
  animator?: {
    rebindSockets: (sockets: {
      steeringWheelGroup: THREE.Group | null;
      wiperLeft: THREE.Group | null;
      wiperRight: THREE.Group | null;
      speedometerNeedle: THREE.Mesh | null;
      tachometerNeedle: THREE.Mesh | null;
      windowOverlay?: WindowWeatherOverlay;
    }) => void;
  };
}

function assetUrl(file: string): string {
  const base = (typeof process !== 'undefined' && process.env.PUBLIC_URL) || './';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${file}`;
}

function asGroup(obj: THREE.Object3D | undefined): THREE.Group | null {
  if (!obj) return null;
  if (obj instanceof THREE.Group) return obj;
  const wrap = new THREE.Group();
  wrap.name = obj.name;
  wrap.position.copy(obj.position);
  wrap.scale.copy(obj.scale);
  obj.position.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  if (obj.parent) {
    obj.parent.add(wrap);
    wrap.add(obj);
  } else {
    wrap.add(obj);
  }
  return wrap;
}

function asMesh(obj: THREE.Object3D | undefined): THREE.Mesh | null {
  if (!obj) return null;
  if (obj instanceof THREE.Mesh) return obj;
  let found: THREE.Mesh | null = null;
  obj.traverse((child) => {
    if (!found && child instanceof THREE.Mesh) found = child;
  });
  return found;
}

/**
 * Dynamic import of Three's GLTFLoader — call only when the flag is on.
 * Not invoked from CarInteriorBootstrap on the default path.
 */
export async function loadGltfInteriorKit(): Promise<GltfInteriorKit | null> {
  if (!isGltfInteriorEnabled()) return null;
  const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
  return { GLTFLoader: mod.GLTFLoader };
}

/**
 * Apply a loaded glTF kit onto the procedural cabin host.
 * Returns false (and leaves the procedural cabin visible) on any failure.
 */
export async function applyGltfInterior(
  kit: GltfInteriorKit,
  host: GltfInteriorHost | null | undefined,
): Promise<boolean> {
  if (!host?.interiorGroup) return false;
  if (host.vehicleType && host.vehicleType !== 'sedan') return false;

  try {
    const loader = new kit.GLTFLoader();
    const gltf = await loader.loadAsync(assetUrl(GLTF_INTERIOR_ASSET));
    const root = gltf.scene;
    root.name = 'heroGltfCabin';
    root.updateMatrixWorld(true);

    const sockets: Partial<Record<GltfInteriorSocket, THREE.Object3D>> = {};
    root.traverse((obj) => {
      if ((GLTF_INTERIOR_SOCKETS as readonly string[]).includes(obj.name)) {
        sockets[obj.name as GltfInteriorSocket] = obj;
      }
    });

    const missing = GLTF_INTERIOR_SOCKETS.filter((name) => !sockets[name]);
    if (missing.length > 0) {
      console.warn('[gltfInterior] missing sockets, keeping procedural cabin:', missing.join(', '));
      return false;
    }

    const wheel = asGroup(sockets.SteeringWheel);
    const wiperL = asGroup(sockets.WiperL);
    const wiperR = asGroup(sockets.WiperR);
    const speedo = asMesh(sockets.SpeedoNeedle);
    const tacho = asMesh(sockets.TachoNeedle);
    const windshield = asMesh(sockets.Windshield);
    const sideL = asMesh(sockets.SideMirrorL);
    const sideR = asMesh(sockets.SideMirrorR);
    const rearGlass = asMesh(sockets.RearviewGlass);
    if (!wheel || !wiperL || !wiperR || !speedo || !tacho || !windshield) {
      console.warn('[gltfInterior] sockets are not the expected Object3D types');
      return false;
    }

    if (host.gltfCabinGroup) {
      host.interiorGroup.remove(host.gltfCabinGroup);
      host.gltfCabinGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
      });
    }

    host.interiorGroup.add(root);
    host.gltfCabinGroup = root;
    if (host.proceduralCabinGroup) {
      host.proceduralCabinGroup.visible = false;
    }

    host.steeringWheelGroup = wheel;
    host.wiperLeft = wiperL;
    host.wiperRight = wiperR;
    host.speedometerNeedle = speedo;
    host.tachometerNeedle = tacho;
    host.windshieldGlassMesh = windshield;
    if (sideL) {
      sideL.name = 'SideMirrorL';
      host.leftMirrorPlane = sideL;
    }
    if (sideR) {
      sideR.name = 'SideMirrorR';
      host.rightMirrorPlane = sideR;
    }
    if (rearGlass) host.rearGlassMesh = rearGlass;
    host.gltfInteriorApplied = true;

    host.animator?.rebindSockets({
      steeringWheelGroup: wheel,
      wiperLeft: wiperL,
      wiperRight: wiperR,
      speedometerNeedle: speedo,
      tachometerNeedle: tacho,
      windowOverlay: host.windowWeatherOverlay,
    });
    return true;
  } catch (err) {
    console.warn(
      '[gltfInterior] load failed; keeping procedural cabin',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
