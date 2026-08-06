import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { RearviewMirror } from '../RearviewMirror';
import type { RearViewSample } from '../rearViewFeed';

// Minimal three.js surface used by RearviewMirror — avoid pulling a real WebGL context.
vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }
  class Euler {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }
  class Object3D {
    position = new Vector3();
    rotation = new Euler();
    name = '';
    children: Object3D[] = [];
    add(child: Object3D) {
      this.children.push(child);
    }
  }
  class Mesh extends Object3D {
    constructor(
      public geometry: { dispose: () => void },
      public material: { dispose: () => void; uniforms: Record<string, { value: number }> }
    ) {
      super();
    }
  }
  class PlaneGeometry {
    dispose() {}
  }
  class BoxGeometry {
    dispose() {}
  }
  class ShaderMaterial {
    uniforms: Record<string, { value: unknown }>;
    constructor(params: { uniforms: Record<string, { value: unknown }> }) {
      this.uniforms = params.uniforms;
    }
    dispose() {}
  }
  class Texture {
    needsUpdate = false;
    wrapS = 0;
    wrapT = 0;
    minFilter = 0;
    magFilter = 0;
    generateMipmaps = true;
    colorSpace = '';
    disposed = false;
    constructor(public image: unknown) {}
    dispose() {
      this.disposed = true;
    }
  }
  class MeshStandardMaterial {
    // three.js material options accepted; unused in mock
    constructor(_params?: unknown) {
      void _params;
    }
    dispose() {}
  }
  class Scene extends Object3D {}
  class WebGLRenderer {}
  return {
    Vector3,
    Euler,
    Object3D,
    Mesh,
    PlaneGeometry,
    BoxGeometry,
    ShaderMaterial,
    MeshStandardMaterial,
    Texture,
    Scene,
    WebGLRenderer,
    ClampToEdgeWrapping: 1001,
    LinearFilter: 1006,
    SRGBColorSpace: 'srgb',
  };
});

function sample(overrides: Partial<RearViewSample> = {}): RearViewSample {
  return {
    image: { tag: 'rear' } as unknown as RearViewSample['image'],
    imageHeading: 270,
    carHeading: 90,
    fov: 90,
    cacheKey: 'pano:P|h18',
    fetchedAt: 0,
    ...overrides,
  };
}

describe('RearviewMirror honest unavailable state', () => {
  let scene: THREE.Scene;
  let renderer: THREE.WebGLRenderer;
  let mirror: RearviewMirror;

  beforeEach(() => {
    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer();
    mirror = new RearviewMirror(scene, renderer);
  });

  it('defaults to rear-unavailable (no fake forward crop)', () => {
    expect(mirror.isRearAvailable()).toBe(false);
    expect(mirror.getStatus()).toMatchObject({
      rearAvailable: false,
      hasCanvas: false,
      hasRearSample: false,
    });
  });

  it('does not mark rear available when only a forward Street View canvas is attached', () => {
    const canvas = document.createElement('canvas');
    mirror.setStreetViewCanvas(canvas);
    // Forward canvas alone is not a true rear feed.
    expect(mirror.isRearAvailable()).toBe(false);
    expect(mirror.getStatus().hasCanvas).toBe(true);
  });

  it('refuses setRearAvailable(true) with no rear sample bound', () => {
    mirror.setRearAvailable(true);
    // An "available" mirror with nothing to sample would render clamped
    // garbage — the honest unavailable glass is the correct fallback.
    expect(mirror.isRearAvailable()).toBe(false);
  });

  it('updateOrientation stays a no-op with no rear sample bound', () => {
    expect(() => mirror.updateOrientation(180, 10)).not.toThrow();
    expect(mirror.getStatus().rearPan).toBe(0);
    expect(mirror.getStatus().rearFade).toBe(0);
  });
});

describe('RearviewMirror with a true rear feed', () => {
  let mirror: RearviewMirror;

  beforeEach(() => {
    mirror = new RearviewMirror(new THREE.Scene(), new THREE.WebGLRenderer());
  });

  it('goes available once a rear sample is bound', () => {
    mirror.setRearSample(sample());
    expect(mirror.isRearAvailable()).toBe(true);
    expect(mirror.getStatus()).toMatchObject({
      rearAvailable: true,
      hasRearSample: true,
      rearPan: 0,
      rearFade: 1,
    });
  });

  it('returns to the honest unavailable glass when the sample is cleared', () => {
    mirror.setRearSample(sample());
    mirror.setRearSample(null);
    expect(mirror.isRearAvailable()).toBe(false);
    expect(mirror.getStatus()).toMatchObject({
      hasRearSample: false,
      rearPan: 0,
      rearFade: 0,
    });
  });

  it('disposes the previous texture when a newer sample replaces it', () => {
    mirror.setRearSample(sample({ cacheKey: 'a' }));
    const first = (
      mirror.getMirrorMesh().material as unknown as {
        uniforms: Record<string, { value: { disposed: boolean } | null }>;
      }
    ).uniforms.rearTex!.value;

    mirror.setRearSample(sample({ cacheKey: 'b' }));
    expect(first?.disposed).toBe(true);
  });

  it('pans the sample to compensate for car rotation since capture', () => {
    mirror.setRearSample(sample({ carHeading: 90, fov: 90 }));

    // Car has turned 22.5° right: a quarter of the 90° sample FOV.
    mirror.updateOrientation(112.5, 0);
    expect(mirror.getStatus().headingDeltaDeg).toBeCloseTo(22.5);
    expect(mirror.getStatus().rearPan).toBeCloseTo(0.25);

    // Turning the other way pans the other way.
    mirror.updateOrientation(67.5, 0);
    expect(mirror.getStatus().rearPan).toBeCloseTo(-0.25);
  });

  it('measures rotation across the 0/360 seam without a full-circle jump', () => {
    mirror.setRearSample(sample({ carHeading: 350 }));
    mirror.updateOrientation(10, 0);
    expect(mirror.getStatus().headingDeltaDeg).toBeCloseTo(20);
  });

  it('fades the stale sample out once the car turns past its coverage', () => {
    mirror.setRearSample(sample({ carHeading: 0, fov: 90 }));

    mirror.updateOrientation(20, 0);
    expect(mirror.getStatus().rearFade).toBe(1);

    mirror.updateOrientation(65, 0);
    const partial = mirror.getStatus().rearFade;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);

    mirror.updateOrientation(95, 0);
    expect(mirror.getStatus().rearFade).toBe(0);
  });

  it('ignores head pitch — the mirror lives in car-body space', () => {
    mirror.setRearSample(sample({ carHeading: 90 }));
    mirror.updateOrientation(90, 45);
    expect(mirror.getStatus().rearPan).toBe(0);
    mirror.updateOrientation(90, -45);
    expect(mirror.getStatus().rearPan).toBe(0);
  });

  it('re-registers against the car heading on each frame tick', () => {
    mirror.setRearSample(sample({ carHeading: 90, fov: 90 }));
    mirror.update(112.5);
    expect(mirror.getStatus().rearPan).toBeCloseTo(0.25);
  });

  it('releases the texture on dispose', () => {
    mirror.setRearSample(sample());
    expect(() => mirror.dispose()).not.toThrow();
    expect(mirror.getStatus().hasRearSample).toBe(false);
  });
});
