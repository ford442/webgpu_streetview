import { describe, it, expect } from 'vitest';
import {
  cabinAudioPanFromHeadYaw,
  carRelativeBearing,
  clampHeadPitch,
  clampHeadYaw,
  dampTowardZero,
  MAX_STEER_RATE_DPS,
  NIGHT_BASE_FLOOR,
  NIGHT_SKY_FLOOR,
  panoramaPovFromCabin,
  steerDeltaFromMouse,
  WEATHER_FALL_Y_SIGN,
  nightBaseLuminance,
  weatherParticleYDelta,
  wiperLowQualityOnPose,
  wiperParkPose,
} from '../carSpatialModel';

describe('carSpatialModel night exposure floors', () => {
  it('keeps full-night luminance well above crushed black', () => {
    expect(NIGHT_BASE_FLOOR).toBeGreaterThanOrEqual(0.10);
    expect(NIGHT_BASE_FLOOR).toBeLessThan(0.35);
    expect(NIGHT_SKY_FLOOR).toBeGreaterThanOrEqual(NIGHT_BASE_FLOOR);
    expect(nightBaseLuminance(0)).toBeCloseTo(1, 5);
    expect(nightBaseLuminance(1)).toBeCloseTo(NIGHT_BASE_FLOOR, 5);
    // Mid-night should still be clearly visible (not ~1% daylight).
    expect(nightBaseLuminance(0.5)).toBeGreaterThan(0.4);
  });
});

describe('carSpatialModel weather fall direction', () => {
  it('uses negative Y in top-origin UV so particles fall downward', () => {
    expect(WEATHER_FALL_Y_SIGN).toBe(-1);
    expect(weatherParticleYDelta(2.2, 1)).toBeLessThan(0);
    expect(weatherParticleYDelta(2.2, 1)).toBeCloseTo(-2.2, 5);
    // Absolute speed — sign is always downward even if a caller passes negative.
    expect(weatherParticleYDelta(-3, 2)).toBeCloseTo(-6, 5);
  });
});

describe('carSpatialModel wiper poses', () => {
  it('uses a raised on-pose distinct from park so low-quality toggle is visible', () => {
    const park = wiperParkPose();
    const on = wiperLowQualityOnPose();
    expect(on.left).not.toBeCloseTo(park.left, 5);
    expect(on.right).not.toBeCloseTo(park.right, 5);
    // Symmetric outward raise.
    expect(on.left).toBeLessThan(park.left);
    expect(on.right).toBeGreaterThan(park.right);
  });
});

describe('carSpatialModel cabin audio pan', () => {
  it('pans right when the head looks right of the chassis', () => {
    expect(cabinAudioPanFromHeadYaw(90, 0)).toBeCloseTo(1, 5);
    expect(cabinAudioPanFromHeadYaw(0, 0)).toBeCloseTo(0, 5);
    expect(cabinAudioPanFromHeadYaw(-45, 0)).toBeCloseTo(-0.5, 5);
  });
});

const deg = (d: number) => (d * Math.PI) / 180;

describe('carSpatialModel panorama POV from the cabin', () => {
  it('is carHeading − headYaw (the compass/Three.js sign flip)', () => {
    expect(panoramaPovFromCabin(34, 0, 0)).toEqual({ heading: 34, pitch: 0 });
    // Looking LEFT (+yaw) turns the compass heading counter-clockwise.
    expect(panoramaPovFromCabin(34, deg(90), 0).heading).toBeCloseTo(304, 9);
    expect(panoramaPovFromCabin(34, deg(-20), 0).heading).toBeCloseTo(54, 9);
    expect(panoramaPovFromCabin(10, deg(30), deg(15))).toEqual({
      heading: expect.closeTo(340, 9),
      pitch: expect.closeTo(15, 9),
    });
  });

  it('clamps the head to ±90° yaw and −45°..+45° pitch', () => {
    expect(clampHeadYaw(deg(120))).toBeCloseTo(deg(90), 12);
    expect(clampHeadYaw(deg(-120))).toBeCloseTo(deg(-90), 12);
    expect(clampHeadPitch(deg(60))).toBeCloseTo(deg(45), 12);
    expect(clampHeadPitch(deg(-60))).toBeCloseTo(deg(-45), 12);
  });

  it('measures world bearings from the car nose', () => {
    expect(carRelativeBearing(124, 34)).toBe(90);
    expect(carRelativeBearing(10, 350)).toBe(20);
  });
});

describe('carSpatialModel head recentre damping', () => {
  it('is frame-rate independent (x · e^(−k·dt))', () => {
    const k = 4;
    let at30 = 1;
    for (let i = 0; i < 30; i++) at30 = dampTowardZero(at30, k, 1 / 30);
    let at144 = 1;
    for (let i = 0; i < 144; i++) at144 = dampTowardZero(at144, k, 1 / 144);
    expect(at30).toBeCloseTo(Math.exp(-k), 9);
    expect(at144).toBeCloseTo(Math.exp(-k), 9);
  });
});

describe('carSpatialModel mouse steering', () => {
  it('turns right for mouse right and caps the yaw rate', () => {
    expect(steerDeltaFromMouse(10, 1 / 60)).toBeGreaterThan(0);
    expect(steerDeltaFromMouse(-10, 1 / 60)).toBeLessThan(0);
    // A huge flick in one 60 Hz event cannot exceed MAX_STEER_RATE_DPS / 60.
    expect(steerDeltaFromMouse(10_000, 1 / 60)).toBeCloseTo(MAX_STEER_RATE_DPS / 60, 9);
  });
});
