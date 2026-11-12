// @vitest-environment jsdom
import { installStreetViewProbe } from './installStreetViewProbe';
import { streetViewProbe } from '../debug/streetViewProbe';

describe('installStreetViewProbe', () => {
  afterEach(() => {
    delete window.__STREETVIEW_PROBE__;
  });

  it('exposes window.__STREETVIEW_PROBE__ backed by the shared probe instance', () => {
    streetViewProbe.clear();
    installStreetViewProbe();
    streetViewProbe.holdArmed(1);
    streetViewProbe.warnLeak('hello');
    streetViewProbe.setScraperHealth({
      status: 'stable',
      canvasCount: 1,
      selectedArea: 90000,
      lastFingerprintAgeMs: 0,
      consecutiveStableTicks: 5,
      lastErrorReason: null,
      lastErrorDetail: null,
      everStable: true,
      updatedAt: 1,
    });

    expect(window.__STREETVIEW_PROBE__?.getTimeline()).toHaveLength(1);
    expect(window.__STREETVIEW_PROBE__?.getWarnings()).toHaveLength(1);
    expect(window.__STREETVIEW_PROBE__?.getScraperHealth()?.status).toBe('stable');

    window.__STREETVIEW_PROBE__?.clear();
    expect(streetViewProbe.getTimeline()).toHaveLength(0);
    expect(streetViewProbe.getScraperHealth().status).toBe('locating');
  });
});
