import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WindowWeatherOverlay } from './WindowWeatherOverlay';
import { createWindowWeatherOverlayUniforms } from '../../shaders/windowWeatherOverlay';
import {
  createNeutralRoadLook,
  publishRoadFrameSource,
  resetRoadFrameSourceForTests,
  type RoadHdrFrame,
} from '../../renderer/roadFrameRegistry';
import { resetCabinMaterialBackendForTests, setCabinMaterialBackend } from './cabinMaterialBackend';
import { publishCabinRendererProbe, readCabinRendererProbe } from './cabinRendererProbe';
import type { CabinTslApi } from './cabinTslMaterials';
import type { WindshieldPortalUniforms } from './cabinPortalMaterial';
import { WET_MASK_ROW_LEFT } from './windshieldWetMask';
import { wiperBladeAngle, WIPER_BAND_HALF_WIDTH } from './windshieldWiperGeometry';


function overlayPhase(overlay: WindowWeatherOverlay): number {
  const mat = overlay.getMesh().material as unknown as { uniforms: { wiperPhase: { value: number } } };
  return mat.uniforms.wiperPhase.value;
}

describe('WindowWeatherOverlay wiper phase', () => {
  it('does not free-run phase in update — animator is the only writer', () => {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    const overlay = new WindowWeatherOverlay(glass);
    overlay.setWipersActive(true, 0.25);
    expect(overlayPhase(overlay)).toBeCloseTo(0.25);
    overlay.update(1.0);
    expect(overlayPhase(overlay)).toBeCloseTo(0.25);
    overlay.setWipersActive(true, 0.6);
    expect(overlayPhase(overlay)).toBeCloseTo(0.6);
    overlay.dispose();
  });
});

// ---------------------------------------------------------------------------
// Windshield portal vs decal
// ---------------------------------------------------------------------------

function fakePortalMaterial(): THREE.Material & { uniforms: WindshieldPortalUniforms } {
  const material = new THREE.MeshBasicMaterial() as unknown as THREE.Material & {
    uniforms: WindshieldPortalUniforms;
  };
  material.uniforms = {
    time: { value: 0 },
    rainIntensity: { value: 0 },
    condensation: { value: 0 },
    glassAspect: { value: 0 },
    hdrFrame: { value: null },
    vibrance: { value: 0 },
    saturation: { value: 0 },
    contrast: { value: 0 },
    exposure: { value: 0 },
    tempMult: { value: new THREE.Vector3(1, 1, 1) },
    nightIntensity: { value: 0 },
    roadRain: { value: 0 },
    graded: { value: 1 },
  };
  return material;
}

/** Just the two factories the overlay/portal touch; everything else is unused here. */
function fakeTsl(): CabinTslApi {
  return {
    createWindowWeatherOverlayMaterial: () => {
      const m = new THREE.MeshBasicMaterial() as unknown as THREE.Material & {
        uniforms: ReturnType<typeof createWindowWeatherOverlayUniforms>;
      };
      m.uniforms = createWindowWeatherOverlayUniforms();
      return m;
    },
    createWindshieldPortalMaterial: () => fakePortalMaterial(),
    createWorldPlaneClippingGroup: () => new THREE.Group(),
  } as unknown as CabinTslApi;
}

function glass(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.75, 4, 2));
  mesh.position.set(0, 1.3, -0.88);
  mesh.rotation.set(-0.15, 0, 0);
  return mesh;
}

function fakeRoadTexture() {
  return { destroy: vi.fn(), createView: vi.fn(), width: 64, height: 36 } as unknown as GPUTexture & {
    destroy: ReturnType<typeof vi.fn>;
  };
}

const CABIN_DEVICE = { label: 'cabin device' } as unknown as GPUDevice;

function publishRoad(texture: GPUTexture, overrides: Partial<RoadHdrFrame> = {}) {
  const source = {
    getFrame: (): RoadHdrFrame => ({
      texture,
      device: CABIN_DEVICE,
      format: 'rg11b10ufloat',
      width: 64,
      height: 36,
      held: false,
      look: createNeutralRoadLook(),
      ...overrides,
    }),
  };
  publishRoadFrameSource(source);
  return source;
}

const ENABLED = { enabled: true, clipDistances: true } as const;

describe('WindowWeatherOverlay: portal vs decal', () => {
  beforeEach(() => setCabinMaterialBackend('webgpu'));
  afterEach(() => {
    resetCabinMaterialBackendForTests();
    resetRoadFrameSourceForTests();
    delete (window as unknown as { __CABIN_RENDERER_PROBE__?: unknown }).__CABIN_RENDERER_PROBE__;
  });

  it('keeps the decal alone on the WebGL cabin, whatever the support object says', () => {
    resetCabinMaterialBackendForTests();
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    expect(overlay.getPortal()).toBeUndefined();
    expect(overlay.getRoot()).toBe(overlay.getMesh());
    overlay.dispose();
  });

  it('keeps the decal alone when support is off (no clip-distances, ?portal=off, ...)', () => {
    const overlay = new WindowWeatherOverlay(glass(), {
      support: { enabled: false, clipDistances: false, reason: 'no clip-distances' },
      tsl: fakeTsl(),
    });
    expect(overlay.getPortal()).toBeUndefined();
    expect(overlay.getRoot()).toBe(overlay.getMesh());
    overlay.dispose();
  });

  it('builds a portal beside the decal when the gate passes, in the same frame', () => {
    const windshield = glass();
    const overlay = new WindowWeatherOverlay(windshield, { support: ENABLED, tsl: fakeTsl() });
    const portal = overlay.getPortal()!;
    expect(portal).toBeDefined();

    const root = overlay.getRoot();
    expect(root).not.toBe(overlay.getMesh());
    expect(root.children).toContain(overlay.getMesh());
    expect(root.children).toContain(portal.root);
    expect(portal.root.children).toContain(portal.getMesh());

    // Both layers register exactly on the glass, nudged toward the cabin.
    const decal = overlay.getMesh();
    expect(portal.getMesh().geometry).toBe(decal.geometry);
    expect(portal.getMesh().position.toArray()).toEqual(decal.position.toArray());
    expect(portal.getMesh().rotation.toArray()).toEqual(decal.rotation.toArray());
    expect(decal.position.z).toBeCloseTo(windshield.position.z + 0.012);
    // The group adds no transform of its own.
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    overlay.dispose();
  });

  it('shows the decal until a road frame exists, then hands over to the portal', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    const portal = overlay.getPortal()!;
    overlay.setWeather(0.8, 0.2);

    // No road renderer yet: today's hole + decal.
    overlay.update(1 / 60);
    expect(portal.isLive()).toBe(false);
    expect(overlay.getMesh().visible).toBe(true);
    expect(portal.getMesh().visible).toBe(false);

    publishRoad(fakeRoadTexture());
    overlay.update(1 / 60);
    expect(portal.isLive()).toBe(true);
    expect(overlay.getMesh().visible).toBe(false);
    expect(portal.getMesh().visible).toBe(true);
    overlay.dispose();
  });

  it('falls back to the decal when the road frame goes away mid-session (renderer torn down / device lost)', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    overlay.setWeather(0.8, 0.2);
    publishRoad(fakeRoadTexture());
    overlay.update(1 / 60);
    expect(overlay.getPortal()!.isLive()).toBe(true);

    resetRoadFrameSourceForTests();
    overlay.update(1 / 60);
    expect(overlay.getPortal()!.isLive()).toBe(false);
    expect(overlay.getMesh().visible).toBe(true);
    expect(overlay.getPortal()!.getMesh().visible).toBe(false);
    overlay.dispose();
  });

  it('refuses a road frame that lives on a different device than the cabin, and takes it once the devices agree', () => {
    // A road renderer replaced onto a new device before the cabin has been rebuilt: binding
    // that texture would be a validation error on every cabin submit.
    const overlay = new WindowWeatherOverlay(glass(), {
      support: { ...ENABLED, device: CABIN_DEVICE },
      tsl: fakeTsl(),
    });
    const portal = overlay.getPortal()!;
    overlay.setWeather(0.8, 0.2);

    publishRoad(fakeRoadTexture(), { device: { label: 'some other device' } as unknown as GPUDevice });
    overlay.update(1 / 60);
    expect(portal.isLive()).toBe(false);
    expect(portal.getMaterial().uniforms.hdrFrame.value).toBeNull(); // never bound
    expect(overlay.getMesh().visible).toBe(true); // hole + decal
    expect(portal.getMesh().visible).toBe(false);

    publishRoad(fakeRoadTexture(), { device: CABIN_DEVICE });
    overlay.update(1 / 60);
    expect(portal.isLive()).toBe(true);
    expect(portal.getMaterial().uniforms.hdrFrame.value).toBeInstanceOf(THREE.ExternalTexture);
    overlay.dispose();
  });

  it('does not leave the wiping mist seed on the decal once the wipers stop', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: { enabled: false, clipDistances: false }, tsl: fakeTsl() });
    const decalRain = () =>
      (overlay.getMesh().material as unknown as { uniforms: { rainIntensity: { value: number } } }).uniforms
        .rainIntensity.value;
    overlay.setWeather(0, 0);
    overlay.setWipersActive(true, 0.1);
    expect(decalRain()).toBeCloseTo(0.12);
    overlay.setWipersActive(false, 0);
    expect(decalRain()).toBe(0);
    overlay.dispose();
  });

  it('draws neither layer on dry, still glass', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    publishRoad(fakeRoadTexture());
    overlay.setWeather(0, 0);
    overlay.update(1 / 60);
    expect(overlay.getMesh().visible).toBe(false);
    expect(overlay.getPortal()!.getMesh().visible).toBe(false);
    overlay.dispose();
  });

  it('keeps the layer up while wiping dry glass, seeding the same light mist as the decal — and drops it when the wipers stop', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    const portal = overlay.getPortal()!;
    publishRoad(fakeRoadTexture());
    overlay.setWeather(0, 0);

    overlay.setWipersActive(true, 0.1);
    overlay.update(1 / 60);
    expect(portal.getMaterial().uniforms.rainIntensity.value).toBeCloseTo(0.12);
    expect(portal.getMesh().visible).toBe(true);

    overlay.setWipersActive(false, 0);
    overlay.update(1 / 60);
    expect(portal.getMaterial().uniforms.rainIntensity.value).toBe(0);
    expect(portal.getMesh().visible).toBe(false);
    overlay.dispose();
  });

  it('wipes to the animator\'s phase and never free-runs it', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    const portal = overlay.getPortal()!;
    publishRoad(fakeRoadTexture());
    overlay.setWeather(0.5, 0);

    // The animator reports the same phase every frame while the blade dwells there.
    for (let i = 0; i < 300; i++) {
      overlay.setWipersActive(true, 0.25);
      overlay.update(1 / 60);
    }
    const reach = wiperBladeAngle(0.25);
    const mask = portal.getWetMask();
    expect(mask.sample(WET_MASK_ROW_LEFT, reach)).toBeLessThan(0.5);
    // Five seconds of updates at a fixed phase did not sweep any further.
    expect(mask.sample(WET_MASK_ROW_LEFT, reach + WIPER_BAND_HALF_WIDTH * 2)).toBe(1);
    overlay.dispose();
  });

  it('binds the road texture and mirrors its look each frame', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    const portal = overlay.getPortal()!;
    const look = createNeutralRoadLook();
    look.exposure = 0.7;
    look.nightIntensity = 0.5;
    look.rainIntensity = 1.2;
    look.graded = false;
    publishRoad(fakeRoadTexture(), { look });
    overlay.setWeather(0.5, 0);
    overlay.update(1 / 60);

    const u = portal.getMaterial().uniforms;
    expect(u.hdrFrame.value).toBeInstanceOf(THREE.ExternalTexture);
    expect(u.exposure.value).toBeCloseTo(0.7);
    expect(u.nightIntensity.value).toBeCloseTo(0.5);
    expect(u.roadRain.value).toBeCloseTo(1.2);
    expect(u.graded.value).toBe(0);
    overlay.dispose();
  });

  it('sizes droplets to the glass\'s proportions', () => {
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    const aspect = overlay.getPortal()!.getMaterial().uniforms.glassAspect.value;
    expect(aspect).toBeGreaterThan(2);
    expect(aspect).toBeLessThan(3);
    overlay.dispose();
  });

  it('dispose leaves the road renderer\'s texture alone', () => {
    const road = fakeRoadTexture();
    const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
    publishRoad(road);
    overlay.setWeather(0.8, 0);
    overlay.update(1 / 60);

    const parent = new THREE.Group();
    parent.add(overlay.getRoot());
    const external = overlay.getPortal()!.getMaterial().uniforms.hdrFrame.value as THREE.ExternalTexture;
    overlay.dispose();
    // Even if something disposes the wrapper afterwards (three does this on teardown),
    // the road's texture must survive: that is what `neuterDestroy` is for.
    external.dispose();
    (external.sourceTexture as unknown as GPUTexture).destroy();
    expect(road.destroy).not.toHaveBeenCalled();
  });

  it('dispose detaches the whole layer from the cabin, portal or not', () => {
    for (const support of [ENABLED, { enabled: false, clipDistances: false, reason: 'off' }]) {
      const overlay = new WindowWeatherOverlay(glass(), { support, tsl: fakeTsl() });
      const parent = new THREE.Group();
      parent.add(overlay.getRoot());
      expect(parent.children).toContain(overlay.getRoot());
      overlay.dispose();
      expect(parent.children).toHaveLength(0);
    }
  });

  describe('probe', () => {
    const baseProbe = () =>
      publishCabinRendererProbe({ backend: 'webgpu', preference: 'webgpu', ready: true, updatedAt: 0 });

    it('says why the portal is off', () => {
      baseProbe();
      new WindowWeatherOverlay(glass(), {
        support: { enabled: false, clipDistances: false, reason: 'no clip-distances' },
        tsl: fakeTsl(),
      }).dispose();
      expect(readCabinRendererProbe()?.portal).toEqual({
        active: false,
        reason: 'no clip-distances',
        clipDistances: false,
      });
    });

    it('reports active, the frame format, and the hold-pause snapshot when the road is held', () => {
      baseProbe();
      const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
      overlay.setWeather(0.8, 0);
      publishRoad(fakeRoadTexture(), { held: true, format: 'rgba16float' });
      overlay.update(1 / 60);
      expect(readCabinRendererProbe()?.portal).toEqual({
        active: true,
        reason: undefined,
        clipDistances: true,
        frameFormat: 'rgba16float',
        held: true,
      });

      publishRoad(fakeRoadTexture(), { held: false, format: 'rgba16float' });
      overlay.update(1 / 60);
      expect(readCabinRendererProbe()?.portal?.held).toBe(false);
      overlay.dispose();
    });

    it('reports the fallback again when the road frame disappears', () => {
      baseProbe();
      const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
      overlay.setWeather(0.8, 0);
      publishRoad(fakeRoadTexture());
      overlay.update(1 / 60);
      expect(readCabinRendererProbe()?.portal?.active).toBe(true);
      resetRoadFrameSourceForTests();
      overlay.update(1 / 60);
      expect(readCabinRendererProbe()?.portal?.active).toBe(false);
      expect(readCabinRendererProbe()?.portal?.reason).toMatch(/hole \+ decal/);
      overlay.dispose();
    });

    it('says so on the probe when the road frame is on another device', () => {
      baseProbe();
      const overlay = new WindowWeatherOverlay(glass(), {
        support: { ...ENABLED, device: CABIN_DEVICE },
        tsl: fakeTsl(),
      });
      overlay.setWeather(0.8, 0);
      publishRoad(fakeRoadTexture(), { device: {} as GPUDevice });
      overlay.update(1 / 60);
      expect(readCabinRendererProbe()?.portal?.active).toBe(false);
      expect(readCabinRendererProbe()?.portal?.reason).toMatch(/different GPUDevice/);
      overlay.dispose();
    });

    it('does not republish an unchanged state every frame', () => {
      baseProbe();
      const overlay = new WindowWeatherOverlay(glass(), { support: ENABLED, tsl: fakeTsl() });
      overlay.setWeather(0.8, 0);
      publishRoad(fakeRoadTexture());
      overlay.update(1 / 60);
      const first = readCabinRendererProbe();
      overlay.update(1 / 60);
      overlay.update(1 / 60);
      expect(readCabinRendererProbe()).toBe(first);
      overlay.dispose();
    });
  });
});
