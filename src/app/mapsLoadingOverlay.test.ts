import { buildMapsLoadingOverlay } from './mapsLoadingOverlay';
import {
  createInitialScraperHealth,
  reduceScraperHealth,
  scraperHealthUserMessage,
  WEBGPU_FAILURE_USER_MESSAGE,
} from '../utils/scraperHealth';

const healthy = reduceScraperHealth(createInitialScraperHealth(), {
  type: 'promoted',
  canvasCount: 1,
  selectedArea: 90000,
});

const baseParams = {
  isConnected: true,
  effectiveMapsKey: 'test-key',
  mapsLoadStatus: 'idle' as const,
  isRetryingMapsAuth: false,
  webgpuStatus: 'initializing' as const,
  isCanvasReady: false,
  canvasError: null,
  mapsAuthError: null,
  scraperHealth: createInitialScraperHealth(),
  handleRetryMapsAuth: jest.fn(),
};

describe('buildMapsLoadingOverlay', () => {
  it('returns null before the user connects', () => {
    expect(buildMapsLoadingOverlay({ ...baseParams, isConnected: false })).toBeNull();
  });

  it('shows missing-key error when effective key is empty', () => {
    const overlay = buildMapsLoadingOverlay({ ...baseParams, effectiveMapsKey: '' });
    expect(overlay?.isVisible).toBe(true);
    expect(overlay?.error).toMatch(/No Google Maps API key is configured/);
    expect(overlay?.retryable).toBe(true);
  });

  it('maps loading-api to connecting message', () => {
    const overlay = buildMapsLoadingOverlay({ ...baseParams, mapsLoadStatus: 'loading-api' });
    expect(overlay?.message).toBe('Connecting to Google Maps...');
    expect(overlay?.progress).toBe(15);
  });

  it('maps retry loading-api to retry message', () => {
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'loading-api',
      isRetryingMapsAuth: true,
    });
    expect(overlay?.message).toBe('Retrying with new key...');
    expect(overlay?.progress).toBe(20);
  });

  it('hides overlay once rendering', () => {
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'rendering',
      scraperHealth: healthy,
    });
    expect(overlay?.isVisible).toBe(false);
  });

  it('shows WebGPU prep while canvas-ready and renderer initializing', () => {
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'canvas-ready',
      webgpuStatus: 'initializing',
      scraperHealth: healthy,
    });
    expect(overlay?.message).toBe('Preparing WebGPU renderer...');
    expect(overlay?.isVisible).toBe(true);
  });

  it('hides WebGPU prep once renderer is ready or on WebGL fallback', () => {
    const ready = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'canvas-ready',
      webgpuStatus: 'ready',
      scraperHealth: healthy,
    });
    expect(ready?.isVisible).toBe(false);

    const fallback = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'canvas-ready',
      webgpuStatus: 'fallback',
      scraperHealth: healthy,
    });
    expect(fallback?.isVisible).toBe(false);
  });

  it('keeps scrape / auth / WebGPU user strings distinct', () => {
    const lost = reduceScraperHealth(healthy, { type: 'lost', reason: 'detached' });
    const auth = reduceScraperHealth(createInitialScraperHealth(), { type: 'auth_blocked' });
    const scrapeMsg = scraperHealthUserMessage(lost);
    const authMsg = scraperHealthUserMessage(auth);
    expect(scrapeMsg).toMatch(/canvas|DOM/i);
    expect(authMsg).toMatch(/authentication|API key|referrer/i);
    expect(WEBGPU_FAILURE_USER_MESSAGE).toMatch(/WebGPU/i);
    expect(scrapeMsg).not.toEqual(authMsg);
    expect(scrapeMsg).not.toEqual(WEBGPU_FAILURE_USER_MESSAGE);
    expect(authMsg).not.toEqual(WEBGPU_FAILURE_USER_MESSAGE);
  });

  it('maps canvas-timeout to location / scrape timeout error with page reload retry', () => {
    const timedOut = reduceScraperHealth(createInitialScraperHealth(), {
      type: 'timeout',
      sawCandidates: true,
      detail: 'Custom timeout message',
    });
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'canvas-timeout',
      canvasError: 'Custom timeout message',
      scraperHealth: timedOut,
    });
    expect(overlay?.error).toBe('Custom timeout message');
    expect(overlay?.retryable).toBe(true);
    expect(typeof overlay?.onRetry).toBe('function');
  });

  it('maps api-error / auth-blocked to auth error with handleRetryMapsAuth', () => {
    const handleRetryMapsAuth = jest.fn();
    const blocked = reduceScraperHealth(createInitialScraperHealth(), {
      type: 'auth_blocked',
      detail: 'Referrer blocked',
    });
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'api-error',
      mapsAuthError: 'Referrer blocked',
      scraperHealth: blocked,
      handleRetryMapsAuth,
    });
    expect(overlay?.error).toBe('Referrer blocked');
    overlay?.onRetry?.();
    expect(handleRetryMapsAuth).toHaveBeenCalled();
  });

  it('shows scrape-lost copy after everStable (distinct from auth)', () => {
    const lost = reduceScraperHealth(healthy, {
      type: 'lost',
      reason: 'detached',
      detail: 'The scraped canvas was removed from the DOM.',
    });
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'rendering',
      scraperHealth: lost,
      webgpuStatus: 'ready',
      isCanvasReady: true,
    });
    expect(overlay?.isVisible).toBe(true);
    expect(overlay?.message).toMatch(/Reconnecting/i);
    expect(overlay?.error).toMatch(/removed from the DOM|canvas/i);
    expect(overlay?.error).not.toMatch(/referrer|API key/i);
  });
});
