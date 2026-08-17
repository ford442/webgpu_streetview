import { describe, it, expect, vi } from 'vitest';
import { applyDriverSeatOffset } from '../seatPosition';

describe('applyDriverSeatOffset', () => {
  it('no-ops when the seat group is missing instead of reading .position', () => {
    expect(applyDriverSeatOffset(undefined, { x: 1, y: 2, z: 3 }, 0.1)).toBe(false);
    expect(applyDriverSeatOffset(null, { x: 1, y: 2, z: 3 }, 0.1)).toBe(false);
    expect(applyDriverSeatOffset({}, { x: 1, y: 2, z: 3 }, 0.1)).toBe(false);
  });

  it('no-ops when cameraPosition is missing', () => {
    const set = vi.fn();
    expect(applyDriverSeatOffset({ position: { set } }, undefined, 0)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it('applies camera anchor plus seat slider', () => {
    const set = vi.fn();
    expect(
      applyDriverSeatOffset({ position: { set } }, { x: -1, y: 2, z: 3 }, 4),
    ).toBe(true);
    expect(set).toHaveBeenCalledWith(-1, 2, 7);
  });
});
