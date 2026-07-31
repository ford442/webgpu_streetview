import { describe, it, expect } from 'vitest';
import {
  NIGHT_BASE_FLOOR,
  NIGHT_SKY_FLOOR,
  WEATHER_FALL_Y_SIGN,
  freeLookDragShouldSteer,
  nightBaseLuminance,
  weatherParticleYDelta,
  wiperLowQualityOnPose,
  wiperParkPose,
} from '../carSpatialModel';

describe('carSpatialModel free-look steering contract', () => {
  it('steers only when the steering wheel is grabbed', () => {
    expect(
      freeLookDragShouldSteer({ isSteeringWheelDrag: true })
    ).toBe(true);
  });

  it('does not steer on RMB or Shift alone', () => {
    expect(
      freeLookDragShouldSteer({
        isSteeringWheelDrag: false,
        isRightMouse: true,
        shiftKey: true,
      })
    ).toBe(false);
    expect(
      freeLookDragShouldSteer({
        isSteeringWheelDrag: false,
        isRightMouse: true,
      })
    ).toBe(false);
    expect(
      freeLookDragShouldSteer({
        isSteeringWheelDrag: false,
        shiftKey: true,
      })
    ).toBe(false);
  });
});

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
