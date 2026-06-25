import { installStreetViewProbe, streetViewProbe } from './streetViewProbe';

function makeCanvas(width = 512, height = 512): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

describe('streetViewProbe timeline', () => {
  beforeEach(() => {
    streetViewProbe.clear();
  });

  it('records a new timeline entry on holdArmed', () => {
    streetViewProbe.holdArmed();
    const timeline = streetViewProbe.getTimeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].firstStableAt).toBeNull();
    expect(timeline[0].releasedAt).toBeNull();
  });

  it('records firstStable only once per hold cycle', () => {
    streetViewProbe.holdArmed();
    streetViewProbe.firstStable();
    const firstStableAt = streetViewProbe.getTimeline()[0].firstStableAt;
    expect(firstStableAt).not.toBeNull();

    streetViewProbe.firstStable();
    expect(streetViewProbe.getTimeline()[0].firstStableAt).toBe(firstStableAt);
  });

  it('computes holdDurationMs on release and clears the active entry', () => {
    streetViewProbe.holdArmed();
    streetViewProbe.firstStable();
    streetViewProbe.released();

    const entry = streetViewProbe.getTimeline()[0];
    expect(entry.releasedAt).not.toBeNull();
    expect(entry.holdDurationMs).toBe(entry.releasedAt! - entry.armedAt);

    // released() with no active hold is a no-op, not a crash.
    expect(() => streetViewProbe.released()).not.toThrow();
  });

  it('ignores firstStable/released calls when no hold is currently armed', () => {
    expect(() => {
      streetViewProbe.firstStable();
      streetViewProbe.released();
    }).not.toThrow();
    expect(streetViewProbe.getTimeline()).toHaveLength(0);
  });

  it('caps the timeline length so it cannot grow unbounded across a long session', () => {
    for (let i = 0; i < 40; i++) {
      streetViewProbe.holdArmed();
      streetViewProbe.released();
    }
    expect(streetViewProbe.getTimeline().length).toBeLessThanOrEqual(25);
  });

  it('clear() resets timeline and warnings', () => {
    streetViewProbe.holdArmed();
    streetViewProbe.warnLeak('test warning');
    streetViewProbe.clear();
    expect(streetViewProbe.getTimeline()).toHaveLength(0);
    expect(streetViewProbe.getWarnings()).toHaveLength(0);
  });
});

describe('streetViewProbe.warnLeak', () => {
  beforeEach(() => {
    streetViewProbe.clear();
  });

  it('records a warning with a message and timestamp', () => {
    streetViewProbe.warnLeak('uploadLiveSource called while holdActive');
    const warnings = streetViewProbe.getWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('uploadLiveSource called while holdActive');
    expect(typeof warnings[0].at).toBe('number');
  });

  it('caps the warning log so a runaway regression cannot leak memory', () => {
    for (let i = 0; i < 80; i++) {
      streetViewProbe.warnLeak(`warning ${i}`);
    }
    expect(streetViewProbe.getWarnings().length).toBeLessThanOrEqual(50);
  });
});

describe('streetViewProbe.checkPixelDrift', () => {
  let currentBrightness = 0;

  // Same resetMocks caveat as panoramaStability.test.ts: the spy must be
  // (re-)installed in beforeEach, and the returned context's methods must be
  // plain functions (not jest.fn()) so they survive Jest's automatic reset
  // between tests once cached.
  beforeEach(() => {
    streetViewProbe.clear();
    streetViewProbe.disablePixelWatch();
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => {
      if (type !== '2d') return null;
      return {
        drawImage: () => {},
        getImageData: () => {
          const v = currentBrightness / 3;
          const data = new Uint8ClampedArray(4 * 4 * 4);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
          }
          return { data, width: 4, height: 4 } as unknown as ImageData;
        },
      } as unknown as CanvasRenderingContext2D;
    }) as typeof HTMLCanvasElement.prototype.getContext);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    streetViewProbe.disablePixelWatch();
  });

  it('does nothing while pixel watch is disabled (the default)', () => {
    currentBrightness = 0;
    streetViewProbe.checkPixelDrift(makeCanvas());
    currentBrightness = 700;
    streetViewProbe.checkPixelDrift(makeCanvas());
    expect(streetViewProbe.getWarnings()).toHaveLength(0);
  });

  it('does not warn on the first sample after enabling (no baseline yet)', () => {
    streetViewProbe.enablePixelWatch();
    currentBrightness = 400;
    streetViewProbe.checkPixelDrift(makeCanvas());
    expect(streetViewProbe.getWarnings()).toHaveLength(0);
  });

  it('does not warn on gradual tick-to-tick drift (weather/look-around)', () => {
    streetViewProbe.enablePixelWatch();
    currentBrightness = 300;
    streetViewProbe.checkPixelDrift(makeCanvas());
    currentBrightness = 320;
    streetViewProbe.checkPixelDrift(makeCanvas());
    currentBrightness = 340;
    streetViewProbe.checkPixelDrift(makeCanvas());
    expect(streetViewProbe.getWarnings()).toHaveLength(0);
  });

  it('warns on an abrupt brightness jump that suggests a different frame swapped in', () => {
    streetViewProbe.enablePixelWatch();
    currentBrightness = 100;
    streetViewProbe.checkPixelDrift(makeCanvas());
    currentBrightness = 500;
    streetViewProbe.checkPixelDrift(makeCanvas());
    const warnings = streetViewProbe.getWarnings();
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[warnings.length - 1].message).toMatch(/possible live GMaps content leak/);
  });

  it('resets the drift baseline when disabling and re-enabling pixel watch', () => {
    streetViewProbe.enablePixelWatch();
    currentBrightness = 100;
    streetViewProbe.checkPixelDrift(makeCanvas());
    streetViewProbe.disablePixelWatch();
    streetViewProbe.enablePixelWatch();
    currentBrightness = 500;
    streetViewProbe.checkPixelDrift(makeCanvas());
    expect(streetViewProbe.getWarnings()).toHaveLength(0);
  });
});

describe('installStreetViewProbe', () => {
  afterEach(() => {
    delete (window as any).__STREETVIEW_PROBE__;
  });

  it('exposes window.__STREETVIEW_PROBE__ backed by the shared probe instance', () => {
    streetViewProbe.clear();
    installStreetViewProbe();
    streetViewProbe.holdArmed();
    streetViewProbe.warnLeak('hello');

    expect(window.__STREETVIEW_PROBE__?.getTimeline()).toHaveLength(1);
    expect(window.__STREETVIEW_PROBE__?.getWarnings()).toHaveLength(1);

    window.__STREETVIEW_PROBE__?.clear();
    expect(streetViewProbe.getTimeline()).toHaveLength(0);
  });
});
