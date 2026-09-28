/**
 * The glass aperture as clip planes, and the clipping group that keeps them in
 * world space while the cabin body rotates every frame.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WorldPlaneClippingGroup } from './cabinPortalMaterial';
import {
    APERTURE_INSET,
    DEFAULT_GLASS_ASPECT,
    computeApertureLocalPlanes,
    computeGlassAspect,
} from './windshieldAperture';

/** The procedural windshield's glass, as `CarInteriorGlazingBuilder` builds it. */
function proceduralGlass(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(1.9, 0.75, 16, 8);
    const pos = geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setZ(i, -(x * x) * 0.15 + (y - 0.375) * 0.12);
    }
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(0, 1.3, -0.88);
    mesh.rotation.set(-0.15, 0, 0);
    mesh.updateMatrix();
    return mesh;
}

/** three's convention: kept where distance >= 0, clipped where negative. */
const kept = (planes: THREE.Plane[], p: THREE.Vector3) => planes.every((pl) => pl.distanceToPoint(p) >= 0);

describe('computeApertureLocalPlanes', () => {
    it('returns four planes — well inside the 8 clip distances hardware clipping allows', () => {
        const glass = proceduralGlass();
        const planes = computeApertureLocalPlanes(glass.geometry, glass.matrix);
        expect(planes).toHaveLength(4);
        expect(planes.length).toBeLessThanOrEqual(8);
    });

    it('keeps the glass interior and clips outside the frame opening', () => {
        const glass = proceduralGlass();
        const planes = computeApertureLocalPlanes(glass.geometry, glass.matrix);
        const toParent = (x: number, y: number) => new THREE.Vector3(x, y, 0).applyMatrix4(glass.matrix);

        expect(kept(planes, toParent(0, 0))).toBe(true);
        expect(kept(planes, toParent(0.9, 0.3))).toBe(true);
        expect(kept(planes, toParent(-0.9, -0.3))).toBe(true);
        // A seal's width in from the edge is trimmed; beyond the edge is gone.
        expect(kept(planes, toParent(0.95 - APERTURE_INSET / 2, 0))).toBe(false);
        expect(kept(planes, toParent(1.2, 0))).toBe(false);
        expect(kept(planes, toParent(-1.2, 0))).toBe(false);
        expect(kept(planes, toParent(0, 0.5))).toBe(false);
        expect(kept(planes, toParent(0, -0.5))).toBe(false);
    });

    it('follows the mesh transform (planes are in the parent frame, not the mesh frame)', () => {
        const glass = proceduralGlass();
        glass.position.set(3, 0, 0);
        glass.rotation.set(0, Math.PI / 2, 0);
        glass.updateMatrix();
        const planes = computeApertureLocalPlanes(glass.geometry, glass.matrix);
        // The glass now sits at x = 3, turned a quarter about Y: its width runs along
        // parent z. So 0.5 either side of its centre is glass, and 1.2 is past its edge.
        expect(kept(planes, new THREE.Vector3(3, 0, 0))).toBe(true);
        expect(kept(planes, new THREE.Vector3(3, 0, 0.5))).toBe(true);
        expect(kept(planes, new THREE.Vector3(3, 0, -0.5))).toBe(true);
        expect(kept(planes, new THREE.Vector3(3, 0, 1.2))).toBe(false);
        expect(kept(planes, new THREE.Vector3(3, 0, -1.2))).toBe(false);
        // Height is still parent y.
        expect(kept(planes, new THREE.Vector3(3, 0.5, 0))).toBe(false);
    });

    it('handles glass authored in a different plane: the two widest axes are the sheet', () => {
        // Same 1.9 × 0.75 sheet, but lying in XZ (height along z) — e.g. an asset exported
        // with a different up axis. The planes must bound x and z, not x and the thin y.
        const geometry = new THREE.PlaneGeometry(1.9, 0.75, 4, 2).rotateX(-Math.PI / 2);
        const identity = new THREE.Matrix4();
        const planes = computeApertureLocalPlanes(geometry, identity);
        expect(planes).toHaveLength(4);
        expect(kept(planes, new THREE.Vector3(0, 0, 0))).toBe(true);
        expect(kept(planes, new THREE.Vector3(0.9, 0, 0.3))).toBe(true);
        expect(kept(planes, new THREE.Vector3(1.2, 0, 0))).toBe(false); // past the width
        expect(kept(planes, new THREE.Vector3(0, 0, 0.5))).toBe(false); // past the height
        // The sheet's thin axis is unconstrained, exactly as for an XY sheet's depth.
        expect(kept(planes, new THREE.Vector3(0, 5, 0))).toBe(true);
    });

    it('honours a custom inset and never inverts a sliver', () => {
        const glass = proceduralGlass();
        const tight = computeApertureLocalPlanes(glass.geometry, glass.matrix, 0.3);
        const p = new THREE.Vector3(0.8, 0, 0).applyMatrix4(glass.matrix);
        expect(kept(tight, p)).toBe(false);

        const sliver = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.02));
        sliver.updateMatrix();
        const planes = computeApertureLocalPlanes(sliver.geometry, sliver.matrix, 5);
        expect(kept(planes, new THREE.Vector3(0, 0, 0))).toBe(true);
    });
});

describe('computeGlassAspect', () => {
    it('reads width over height for the procedural glass, including its rake and curve', () => {
        const glass = proceduralGlass();
        const aspect = computeGlassAspect(glass.geometry, glass.scale);
        expect(aspect).toBeGreaterThan(2.2);
        expect(aspect).toBeLessThan(2.6);
    });

    it('is independent of which axes the sheet lies in', () => {
        const xy = computeGlassAspect(proceduralGlass().geometry, new THREE.Vector3(1, 1, 1));
        const xz = computeGlassAspect(
            new THREE.PlaneGeometry(1.9, 0.75, 16, 8).rotateX(-Math.PI / 2),
            new THREE.Vector3(1, 1, 1),
        );
        const yz = computeGlassAspect(
            new THREE.PlaneGeometry(1.9, 0.75, 16, 8).rotateY(Math.PI / 2),
            new THREE.Vector3(1, 1, 1),
        );
        expect(xz).toBeCloseTo(1.9 / 0.75, 5);
        expect(yz).toBeCloseTo(1.9 / 0.75, 5);
        expect(xy).toBeGreaterThan(2.2); // the curved, raked one reads a touch shorter — as before
    });

    it('respects mesh scale', () => {
        const geometry = new THREE.PlaneGeometry(1, 1);
        expect(computeGlassAspect(geometry, new THREE.Vector3(2, 1, 1))).toBeCloseTo(2);
    });

    it('falls back to the procedural proportions on a degenerate mesh', () => {
        const empty = new THREE.BufferGeometry();
        empty.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
        expect(computeGlassAspect(empty, new THREE.Vector3(1, 1, 1))).toBe(DEFAULT_GLASS_ASPECT);
    });
});

describe('WorldPlaneClippingGroup', () => {
    const plane = (nx: number, ny: number, nz: number, c: number) =>
        new THREE.Plane(new THREE.Vector3(nx, ny, nz), c);

    it('is a union clipping group — the only kind hardware clip distances can express', () => {
        const group = new WorldPlaneClippingGroup([plane(1, 0, 0, 0)]);
        expect((group as unknown as { isClippingGroup: boolean }).isClippingGroup).toBe(true);
        expect(group.clipIntersection).toBe(false);
    });

    it('re-projects its planes from matrixWorld on every update, so a rotating cabin never clips with stale planes', () => {
        const scene = new THREE.Scene();
        const body = new THREE.Group();
        scene.add(body);
        // Keep x >= 1 in the body's own frame.
        const clip = new WorldPlaneClippingGroup([plane(1, 0, 0, -1)]);
        body.add(clip);

        scene.updateMatrixWorld(true);
        expect(clip.clippingPlanes[0]!.distanceToPoint(new THREE.Vector3(2, 0, 0))).toBeCloseTo(1);

        // The car runtime rotates the body *after* the interior update, every frame.
        body.rotation.y = Math.PI / 2;
        scene.updateMatrixWorld(true);
        // Body-local +x now points along world -z, so the kept half-space's boundary
        // moved with it: world (0,0,-2) is now 1 unit inside, world (2,0,0) is on the plane's side of nothing.
        expect(clip.clippingPlanes[0]!.distanceToPoint(new THREE.Vector3(0, 0, -2))).toBeCloseTo(1);
        expect(clip.clippingPlanes[0]!.distanceToPoint(new THREE.Vector3(2, 0, 0))).toBeCloseTo(-1);
    });

    it('follows a translating parent too', () => {
        const scene = new THREE.Scene();
        const body = new THREE.Group();
        scene.add(body);
        const clip = new WorldPlaneClippingGroup([plane(0, 1, 0, 0)]); // keep y >= 0
        body.add(clip);
        body.position.y = 5;
        scene.updateMatrixWorld(true);
        expect(clip.clippingPlanes[0]!.distanceToPoint(new THREE.Vector3(0, 5, 0))).toBeCloseTo(0);
        expect(clip.clippingPlanes[0]!.distanceToPoint(new THREE.Vector3(0, 4, 0))).toBeCloseTo(-1);
    });

    it('does not mutate the planes it was built from', () => {
        const source = plane(1, 0, 0, -1);
        const scene = new THREE.Scene();
        const body = new THREE.Group();
        body.position.x = 10;
        scene.add(body);
        body.add(new WorldPlaneClippingGroup([source]));
        scene.updateMatrixWorld(true);
        expect(source.constant).toBe(-1);
    });
});
