import { headingPitchToPan, heldLookAroundUvDelta, wrapPanDelta } from './panoramaLookAround';

describe('panoramaLookAround', () => {
  it('normalizes heading and pitch to 0–1 pan coords', () => {
    expect(headingPitchToPan(0, -90)).toEqual({ panX: 0, panY: 0 });
    expect(headingPitchToPan(180, 0)).toEqual({ panX: 0.5, panY: 0.5 });
    expect(headingPitchToPan(360, 90)).toEqual({ panX: 0, panY: 1 });
  });

  it('wraps pan delta across the heading seam', () => {
    expect(wrapPanDelta(0.02, 0.98)).toBeCloseTo(0.04, 5);
    expect(wrapPanDelta(0.98, 0.02)).toBeCloseTo(-0.04, 5);
    expect(wrapPanDelta(0.55, 0.5)).toBeCloseTo(0.05, 5);
  });

  it('produces non-zero UV delta when the user looks around during hold', () => {
    const atCapture = heldLookAroundUvDelta(34, 10, 34, 10, 1);
    expect(atCapture.deltaX).toBe(0);
    expect(atCapture.deltaY).toBe(0);

    const swungRight = heldLookAroundUvDelta(64, 10, 34, 10, 1);
    expect(swungRight.deltaX).toBeGreaterThan(0);
    expect(swungRight.deltaY).toBe(0);

    const lookedUp = heldLookAroundUvDelta(34, 25, 34, 10, 1);
    expect(lookedUp.deltaX).toBe(0);
    expect(lookedUp.deltaY).toBeGreaterThan(0);
  });

  it('scales look delta inversely with zoom', () => {
    const zoom1 = heldLookAroundUvDelta(64, 10, 34, 10, 1);
    const zoom2 = heldLookAroundUvDelta(64, 10, 34, 10, 2);
    expect(Math.abs(zoom2.deltaX)).toBeLessThan(Math.abs(zoom1.deltaX));
  });
});
