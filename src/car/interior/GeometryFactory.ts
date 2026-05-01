import * as THREE from 'three';

/**
 * Shared geometry cache for car interior parts.
 * Re-using BoxGeometry / CylinderGeometry instances across meshes
 * reduces GPU memory and speeds up scene construction.
 */
export class GeometryFactory {
  private cache = new Map<string, THREE.BufferGeometry>();

  private key(name: string, ...dims: number[]): string {
    return `${name}:${dims.join(',')}`;
  }

  getBox(w: number, h: number, d: number): THREE.BoxGeometry {
    const k = this.key('box', w, h, d);
    let g = this.cache.get(k) as THREE.BoxGeometry | undefined;
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.cache.set(k, g);
    }
    return g;
  }

  getCylinder(rt: number, rb: number, h: number, seg = 16): THREE.CylinderGeometry {
    const k = this.key('cyl', rt, rb, h, seg);
    let g = this.cache.get(k) as THREE.CylinderGeometry | undefined;
    if (!g) {
      g = new THREE.CylinderGeometry(rt, rb, h, seg);
      this.cache.set(k, g);
    }
    return g;
  }

  getSphere(r: number, ws = 16, hs = 12): THREE.SphereGeometry {
    const k = this.key('sph', r, ws, hs);
    let g = this.cache.get(k) as THREE.SphereGeometry | undefined;
    if (!g) {
      g = new THREE.SphereGeometry(r, ws, hs);
      this.cache.set(k, g);
    }
    return g;
  }

  getPlane(w: number, h: number): THREE.PlaneGeometry {
    const k = this.key('plane', w, h);
    let g = this.cache.get(k) as THREE.PlaneGeometry | undefined;
    if (!g) {
      g = new THREE.PlaneGeometry(w, h);
      this.cache.set(k, g);
    }
    return g;
  }

  getCircle(r: number, seg = 32): THREE.CircleGeometry {
    const k = this.key('circle', r, seg);
    let g = this.cache.get(k) as THREE.CircleGeometry | undefined;
    if (!g) {
      g = new THREE.CircleGeometry(r, seg);
      this.cache.set(k, g);
    }
    return g;
  }

  /** Create a rounded-rect Shape for extruded dash panels etc. */
  getRoundedRectShape(w: number, h: number, r: number): THREE.Shape {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return shape;
  }

  dispose(): void {
    this.cache.forEach(g => g.dispose());
    this.cache.clear();
  }
}
