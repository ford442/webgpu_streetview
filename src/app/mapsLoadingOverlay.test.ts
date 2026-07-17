import { buildMapsLoadingOverlay } from './mapsLoadingOverlay';

const baseParams = {
  isConnected: true,
  effectiveMapsKey: 'test-key',
  mapsLoadStatus: 'idle' as const,
  isRetryingMapsAuth: false,
  webgpuStatus: 'initializing' as const,
  isCanvasReady: false,
  canvasError: null,
  mapsAuthError: null,
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
    const overlay = buildMapsLoadingOverlay({ ...baseParams, mapsLoadStatus: 'rendering' });
    expect(overlay?.isVisible).toBe(false);
  });

  it('shows WebGPU prep while canvas-ready and renderer initializing', () => {
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'canvas-ready',
      webgpuStatus: 'initializing',
    });
    expect(overlay?.message).toBe('Preparing WebGPU renderer...');
    expect(overlay?.isVisible).toBe(true);
  });

  it('hides WebGPU prep once renderer is ready', () => {
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'canvas-ready',
      webgpuStatus: 'ready',
    });
    expect(overlay?.isVisible).toBe(false);
  });

  it('maps canvas-timeout to location error with page reload retry', () => {
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'canvas-timeout',
      canvasError: 'Custom timeout message',
    });
    expect(overlay?.error).toBe('Custom timeout message');
    expect(overlay?.retryable).toBe(true);
    expect(typeof overlay?.onRetry).toBe('function');
  });

  it('maps api-error to auth error with handleRetryMapsAuth', () => {
    const handleRetryMapsAuth = jest.fn();
    const overlay = buildMapsLoadingOverlay({
      ...baseParams,
      mapsLoadStatus: 'api-error',
      mapsAuthError: 'Referrer blocked',
      handleRetryMapsAuth,
    });
    expect(overlay?.error).toBe('Referrer blocked');
    overlay?.onRetry?.();
    expect(handleRetryMapsAuth).toHaveBeenCalled();
  });
});
