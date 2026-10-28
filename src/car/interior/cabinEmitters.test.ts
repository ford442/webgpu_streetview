// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VEHICLES } from '../VehicleManager';
import { FrustumCuller } from './performance';
import { CarInteriorDashboardBuilder } from './CarInteriorDashboardBuilder';
import { CarInteriorGauges } from './CarInteriorGauges';
import { GeometryFactory } from './GeometryFactory';
import { LODManager } from './LODManager';
import { LocationPanel } from './LocationPanel';
import { CLUSTER_WELL_EMISSIVE, CONTENT_MAP_EMISSIVE, DISPLAY_HOUSING_EMISSIVE } from './cabinLightingRamps';
import type { CarInteriorMaterials } from './CarInteriorBuilder';

/**
 * jsdom has no 2D canvas. The dial/clock/panel constructors only need a
 * context that accepts the paint calls; the emissive colour is what this
 * pins, because Three multiplies it by the painted map.
 */
function stub2d(): void {
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext' as never).mockReturnValue(ctx as never);
}

describe('cabin content emitters', () => {
  beforeEach(stub2d);
  afterEach(() => vi.restoreAllMocks());

  it('lets dial faces emit their painted ticks instead of a dark tint', () => {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial();
    const built = CarInteriorGauges.build(
      group,
      metal,
      VEHICLES.sedan,
      { name: 'medium' },
      'medium',
    );
    expect(built.gaugeRig.dialMaterials.length).toBeGreaterThanOrEqual(4);
    for (const mat of built.gaugeRig.dialMaterials) {
      expect(mat.emissive.getHex()).toBe(CONTENT_MAP_EMISSIVE);
      expect(mat.emissiveMap).toBe(mat.map);
    }
    for (const mat of built.gaugeRig.needleMaterials) {
      const e = mat.emissive;
      expect(Math.max(e.r, e.g, e.b)).toBeGreaterThan(0.4);
    }
    expect(built.digitalClock?.getMaterial().emissive.getHex()).toBe(CONTENT_MAP_EMISSIVE);
  });

  it('keeps the cluster well and screen housing dark so they are not neon slabs', () => {
    const group = new THREE.Group();
    const mat = () => new THREE.MeshStandardMaterial();
    const materials: CarInteriorMaterials = {
      dashboard: mat(),
      leather: mat(),
      metal: mat(),
      frame: mat(),
      glass: mat(),
      mirror: mat(),
      accent: mat(),
      chrome: new THREE.MeshPhysicalMaterial(),
    };
    const built = new CarInteriorDashboardBuilder(
      group,
      materials,
      VEHICLES.sedan,
      'low',
      new GeometryFactory(),
      new LODManager(new FrustumCuller()),
    ).build();
    expect(built.glowSprites).toHaveLength(0);
    expect(built.instrumentClusterMat.emissive.getHex()).toBe(CLUSTER_WELL_EMISSIVE);
    expect(built.centerDisplayMat.emissive.getHex()).toBe(DISPLAY_HOUSING_EMISSIVE);
    expect(built.instrumentClusterMat.emissive.getHex()).not.toBe(
      parseInt(VEHICLES.sedan.accentColor.replace('#', ''), 16),
    );
  });

  it('lets the location panel emit its painted VFD instead of an accent multiply', () => {
    const panel = new LocationPanel(VEHICLES.convertible.accentColor, 'medium');
    const mat = panel.getMaterial();
    expect(mat.emissive.getHex()).toBe(CONTENT_MAP_EMISSIVE);
    expect(mat.emissiveMap).toBe(mat.map);
  });
});
