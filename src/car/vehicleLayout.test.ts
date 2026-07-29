import { describe, expect, it } from 'vitest';
import { getVehicleConfig } from './VehicleManager';
import {
  DEFAULT_GAUGE_LAYOUT,
  DEFAULT_STEERING_WHEEL,
  resolveCameraFov,
  resolveGaugeLayout,
  resolveSteeringWheel,
  zoomToVerticalFov,
} from './vehicleLayout';

describe('vehicleLayout', () => {
  it('resolveGaugeLayout merges per-vehicle partial overrides', () => {
    const convertible = getVehicleConfig('convertible');
    const layout = resolveGaugeLayout(convertible);
    expect(layout.speed.y).toBe(0.68);
    expect(layout.dialRadius).toBe(0.08);
    expect(layout.speed.x).toBe(DEFAULT_GAUGE_LAYOUT.speed.x);
  });

  it('resolveSteeringWheel merges position overrides', () => {
    const lab = getVehicleConfig('science-lab');
    const wheel = resolveSteeringWheel(lab);
    expect(wheel.rimRadius).toBe(0.14);
    expect(wheel.position.x).toBe(DEFAULT_STEERING_WHEEL.position.x);
    expect(wheel.position.y).toBe(0.88);
  });

  it('resolveCameraFov returns per-vehicle endpoints', () => {
    const sedan = resolveCameraFov(getVehicleConfig('sedan'));
    expect(sedan.base).toBe(58);
    expect(sedan.max).toBe(88);

    const limo = resolveCameraFov(getVehicleConfig('limousine'));
    expect(limo.base).toBe(56);
  });

  it('zoomToVerticalFov maps zoom=1 to base FOV', () => {
    const fov = resolveCameraFov(getVehicleConfig('sedan'));
    expect(zoomToVerticalFov(1, fov)).toBeCloseTo(fov.base, 5);
  });

  it('zoomToVerticalFov widens at zoom-out and narrows at zoom-in', () => {
    const fov = resolveCameraFov(getVehicleConfig('sedan'));
    expect(zoomToVerticalFov(0.5, fov)).toBeGreaterThan(fov.base);
    expect(zoomToVerticalFov(3, fov)).toBeLessThan(fov.base);
  });

  it('every vehicle defines defaultSeatOffset and cameraFov', () => {
    for (const type of ['sedan', 'convertible', 'science-lab', 'limousine'] as const) {
      const cfg = getVehicleConfig(type);
      expect(cfg.defaultSeatOffset).toBeGreaterThanOrEqual(0);
      expect(cfg.cameraFov.base).toBeGreaterThan(cfg.cameraFov.min);
      expect(cfg.cameraFov.max).toBeGreaterThan(cfg.cameraFov.base);
    }
  });
});
