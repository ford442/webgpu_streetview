import {
  getCanvasFingerprint,
  STABILITY_MAX_TICKS,
  STABILITY_MAX_WAIT_MS,
  STABILITY_MIN_DELAY_MS,
  STABILITY_MIN_DELAY_TICKS,
  STABILITY_POLL_INTERVAL_MS,
  STABILITY_REQUIRED_STABLE_MS,
  STABILITY_REQUIRED_STABLE_TICKS,
} from './panoramaStability';

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

describe('panoramaStability constants', () => {
  it('derives tick counts from millisecond durations exactly (no rounding drift)', () => {
    expect(STABILITY_REQUIRED_STABLE_TICKS * STABILITY_POLL_INTERVAL_MS).toBe(STABILITY_REQUIRED_STABLE_MS);
    expect(STABILITY_MIN_DELAY_TICKS * STABILITY_POLL_INTERVAL_MS).toBe(STABILITY_MIN_DELAY_MS);
    expect(STABILITY_MAX_TICKS * STABILITY_POLL_INTERVAL_MS).toBe(STABILITY_MAX_WAIT_MS);
  });

  it('keeps the minimum hold/stability window inside the documented 400-500ms AC', () => {
    expect(STABILITY_MIN_DELAY_MS).toBeGreaterThanOrEqual(400);
    expect(STABILITY_REQUIRED_STABLE_MS).toBeLessThanOrEqual(500);
  });

  it('caps the fallback well above the required-stable window so it never fires first', () => {
    expect(STABILITY_MAX_TICKS).toBeGreaterThan(STABILITY_REQUIRED_STABLE_TICKS);
    expect(STABILITY_MAX_TICKS).toBeGreaterThan(STABILITY_MIN_DELAY_TICKS);
  });
});

describe('getCanvasFingerprint', () => {
  it('returns empty string for canvases below the 256px usability floor', () => {
    expect(getCanvasFingerprint(makeCanvas(128, 128))).toBe('');
    expect(getCanvasFingerprint(makeCanvas(300, 100))).toBe('');
  });

  it('degrades gracefully (no throw, empty string) when no 2d context is available', () => {
    const spy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => getCanvasFingerprint(makeCanvas(512, 512))).not.toThrow();
    expect(getCanvasFingerprint(makeCanvas(512, 512))).toBe('');
    spy.mockRestore();
  });

  // getCanvasFingerprint memoizes a single offscreen <canvas>/2d-context pair at module
  // scope (a perf optimization — it's polled every tick). That means the mocked context
  // object below is only ever created once across this whole describe block; tests drive
  // its output by mutating `currentColor` before calling getCanvasFingerprint, rather than
  // by re-mocking getContext per test.
  describe('with a working 2d context', () => {
    let currentColor: [number, number, number] = [0, 0, 0];

    // CRA's Jest config sets resetMocks: true, which wipes mockImplementation
    // before every test — so the spy must be (re-)installed in beforeEach, not
    // beforeAll. It only actually gets *called* once across this describe block
    // because getCanvasFingerprint memoizes the returned context (see above), so
    // the returned object's methods are plain functions, not jest.fn() — a
    // jest.fn() embedded in that cached object would otherwise also get reset
    // (its implementation wiped) before the next test even though nothing
    // re-creates it.
    beforeEach(() => {
      jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => {
        if (type !== '2d') return null;
        return {
          drawImage: () => {},
          getImageData: () => {
            const [r, g, b] = currentColor;
            const data = new Uint8ClampedArray(4 * 4 * 4);
            for (let i = 0; i < data.length; i += 4) {
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
              data[i + 3] = 255;
            }
            return { data, width: 4, height: 4 } as unknown as ImageData;
          },
        } as unknown as CanvasRenderingContext2D;
      }) as typeof HTMLCanvasElement.prototype.getContext);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('treats a near-black frame as not-yet-usable (still loading), not a valid fingerprint', () => {
      currentColor = [0, 0, 0];
      expect(getCanvasFingerprint(makeCanvas(512, 512))).toBe('');
    });

    it('accepts a genuinely dark (but not near-black) frame so night scenes do not hang forever', () => {
      currentColor = [5, 5, 5];
      expect(getCanvasFingerprint(makeCanvas(512, 512))).not.toBe('');
    });

    it('produces a stable fingerprint string for a normal bright frame, keyed by canvas size', () => {
      currentColor = [120, 80, 40];
      const fp1 = getCanvasFingerprint(makeCanvas(512, 256));
      const fp2 = getCanvasFingerprint(makeCanvas(512, 256));
      expect(fp1).toMatch(/^512x256-/);
      expect(fp1).toBe(fp2);
    });

    it('changes the fingerprint when the sampled content changes', () => {
      currentColor = [120, 80, 40];
      const fp1 = getCanvasFingerprint(makeCanvas(400, 400));
      currentColor = [10, 20, 30];
      const fp2 = getCanvasFingerprint(makeCanvas(400, 400));
      expect(fp1).not.toBe(fp2);
    });
  });
});
