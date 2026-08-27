import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCinemaSidecarSession } from './cinemaSidecar';

describe('createCinemaSidecarSession', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records look/vehicle and unique pano samples', () => {
    const session = createCinemaSidecarSession({ lookId: 'noir', vehicleType: 'convertible' });
    session.note('p1', '2012-06');
    session.note('p1', '2012-06');
    (performance.now as unknown as { mockReturnValue: (n: number) => void }).mockReturnValue(1200);
    session.note('p2', '2012-06');
    expect(session.toJSON()).toEqual({
      capture: 'road-only',
      lookId: 'noir',
      vehicleType: 'convertible',
      samples: [
        { tMs: 0, panoId: 'p1', imageDate: '2012-06' },
        { tMs: 1200, panoId: 'p2', imageDate: '2012-06' },
      ],
    });
  });
});
