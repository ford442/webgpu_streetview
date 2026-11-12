import {
  createInitialScraperHealth,
  reduceScraperHealth,
  scraperHealthUserMessage,
  SCRAPER_CONTAINER_INVARIANTS,
  WEBGPU_FAILURE_USER_MESSAGE,
  type ScraperHealth,
} from './scraperHealth';

describe('scraperHealth reducer', () => {
  const t0 = 1000;

  it('starts in locating with empty metrics', () => {
    const h = createInitialScraperHealth(t0);
    expect(h.status).toBe('locating');
    expect(h.canvasCount).toBe(0);
    expect(h.everStable).toBe(false);
    expect(h.lastErrorReason).toBeNull();
  });

  it('moves locating → promoting on fingerprintable candidate', () => {
    let h = createInitialScraperHealth(t0);
    h = reduceScraperHealth(h, {
      type: 'scan',
      canvasCount: 2,
      selectedArea: 512 * 512,
      hasCandidate: true,
      fingerprintOk: true,
      now: t0 + 1,
    });
    expect(h.status).toBe('promoting');
    expect(h.canvasCount).toBe(2);
    expect(h.selectedArea).toBe(512 * 512);
  });

  it('stays promoting / records near-black when fingerprint empty', () => {
    let h = createInitialScraperHealth(t0);
    h = reduceScraperHealth(h, {
      type: 'scan',
      canvasCount: 1,
      selectedArea: 640 * 480,
      hasCandidate: true,
      fingerprintOk: false,
      rejectReason: 'near-black',
      now: t0 + 1,
    });
    expect(h.status).toBe('promoting');
    expect(h.lastErrorReason).toBe('near-black');
    expect(h.consecutiveStableTicks).toBe(0);
  });

  it('tick increments consecutive stable counts then promoted → stable', () => {
    let h = createInitialScraperHealth(t0);
    h = reduceScraperHealth(h, {
      type: 'scan',
      canvasCount: 1,
      selectedArea: 90000,
      hasCandidate: true,
      fingerprintOk: true,
      now: t0,
    });
    h = reduceScraperHealth(h, {
      type: 'tick',
      sameFingerprint: true,
      canvasCount: 1,
      selectedArea: 90000,
      requiredStableTicks: 5,
      now: t0 + 100,
    });
    expect(h.consecutiveStableTicks).toBe(1);
    expect(h.status).toBe('promoting');

    h = reduceScraperHealth(h, {
      type: 'tick',
      sameFingerprint: false,
      canvasCount: 1,
      selectedArea: 90000,
      requiredStableTicks: 5,
      now: t0 + 200,
    });
    expect(h.consecutiveStableTicks).toBe(1);

    h = reduceScraperHealth(h, {
      type: 'promoted',
      canvasCount: 1,
      selectedArea: 90000,
      now: t0 + 300,
    });
    expect(h.status).toBe('stable');
    expect(h.everStable).toBe(true);
    expect(h.lastErrorReason).toBeNull();
  });

  it('cold-start timeout sets timeout status with distinct copy', () => {
    let h = createInitialScraperHealth(t0);
    h = reduceScraperHealth(h, {
      type: 'timeout',
      sawCandidates: false,
      now: t0 + 6500,
    });
    expect(h.status).toBe('timeout');
    expect(h.lastErrorReason).toBe('timeout');
    expect(scraperHealthUserMessage(h)).toMatch(/no Street View canvas/i);
  });

  it('auth_blocked is distinct from scrape lost / timeout', () => {
    let h = createInitialScraperHealth(t0);
    h = reduceScraperHealth(h, {
      type: 'auth_blocked',
      detail: 'ReferrerNotAllowedMapError',
      now: t0,
    });
    expect(h.status).toBe('auth-blocked');
    expect(h.lastErrorReason).toBe('auth');
    expect(scraperHealthUserMessage(h)).toContain('ReferrerNotAllowedMapError');
    expect(scraperHealthUserMessage(h)).not.toMatch(/canvas scrape was lost/i);
    expect(WEBGPU_FAILURE_USER_MESSAGE).toMatch(/WebGPU/i);
  });

  it('scan ignores further locate while auth-blocked', () => {
    let h = createInitialScraperHealth(t0);
    h = reduceScraperHealth(h, { type: 'auth_blocked', now: t0 });
    h = reduceScraperHealth(h, {
      type: 'scan',
      canvasCount: 1,
      selectedArea: 90000,
      hasCandidate: true,
      fingerprintOk: true,
      now: t0 + 1,
    });
    expect(h.status).toBe('auth-blocked');
  });

  it('after stable, zero canvases → lost (mid-session replace)', () => {
    let h: ScraperHealth = {
      ...createInitialScraperHealth(t0),
      status: 'stable',
      everStable: true,
      canvasCount: 1,
      selectedArea: 90000,
      lastFingerprintAgeMs: 0,
    };
    h = reduceScraperHealth(h, {
      type: 'scan',
      canvasCount: 0,
      selectedArea: 0,
      hasCandidate: false,
      fingerprintOk: false,
      now: t0 + 50,
    });
    expect(h.status).toBe('lost');
    expect(h.lastErrorReason).toBe('no-canvas');
    expect(scraperHealthUserMessage(h)).toMatch(/No panorama canvas/i);
  });

  it('self_check detached → lost; recovery scan → promoting', () => {
    let h: ScraperHealth = {
      ...createInitialScraperHealth(t0),
      status: 'stable',
      everStable: true,
      selectedArea: 90000,
      canvasCount: 1,
    };
    h = reduceScraperHealth(h, {
      type: 'self_check',
      canvasAttached: false,
      canvasCount: 0,
      selectedArea: 0,
      fingerprintChanged: false,
      now: t0 + 10,
    });
    expect(h.status).toBe('lost');
    expect(h.lastErrorReason).toBe('detached');

    h = reduceScraperHealth(h, {
      type: 'self_check',
      canvasAttached: true,
      canvasCount: 1,
      selectedArea: 512 * 512,
      fingerprintChanged: false,
      now: t0 + 20,
    });
    expect(h.status).toBe('promoting');
  });

  it('self_check fingerprint change while stable refreshes age (Maps still painting)', () => {
    let h: ScraperHealth = {
      ...createInitialScraperHealth(t0),
      status: 'stable',
      everStable: true,
      lastFingerprintAgeMs: 5000,
      canvasCount: 1,
      selectedArea: 90000,
    };
    h = reduceScraperHealth(h, {
      type: 'self_check',
      canvasAttached: true,
      canvasCount: 1,
      selectedArea: 90000,
      fingerprintChanged: true,
      now: t0 + 100,
    });
    expect(h.status).toBe('stable');
    expect(h.lastFingerprintAgeMs).toBe(0);
  });
});

describe('SCRAPER_CONTAINER_INVARIANTS', () => {
  it('documents opacity:1 and min canvas edge (Google scrape contract)', () => {
    expect(SCRAPER_CONTAINER_INVARIANTS.opacity).toBe(1);
    expect(SCRAPER_CONTAINER_INVARIANTS.pointerEvents).toBe('none');
    expect(SCRAPER_CONTAINER_INVARIANTS.minCanvasEdgePx).toBe(256);
  });
});
