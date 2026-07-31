import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { RearviewMirror } from '../RearviewMirror';

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
    uniforms: Record<string, { value: number }>;
    constructor(params: { uniforms: Record<string, { value: number }> }) {
      this.uniforms = params.uniforms;
    }
    dispose() {}
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
    Scene,
    WebGLRenderer,
  };
});

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
    expect(mirror.getStatus()).toEqual({ rearAvailable: false, hasCanvas: false });
  });

  it('does not mark rear available when only a forward Street View canvas is attached', () => {
    const canvas = document.createElement('canvas');
    mirror.setStreetViewCanvas(canvas);
    // Forward canvas alone is not a true rear feed.
    expect(mirror.isRearAvailable()).toBe(false);
    expect(mirror.getStatus().hasCanvas).toBe(true);
  });

  it('exposes setRearAvailable for a future true-rear feed', () => {
    mirror.setRearAvailable(true);
    expect(mirror.isRearAvailable()).toBe(true);
    mirror.setRearAvailable(false);
    expect(mirror.isRearAvailable()).toBe(false);
  });

  it('updateOrientation remains a no-op (does not invent a rear crop)', () => {
    expect(() => mirror.updateOrientation(180, 10)).not.toThrow();
  });
});
