// @vitest-environment jsdom
import { vi, type Mock } from 'vitest';
import { createStreetViewRenderer } from './createStreetViewRenderer';
import { Renderer } from './Renderer';
import { publishWebGpuProbe } from './webgpuBootProbe';

// Test-only view of window for installing/removing globals without `any`.
const win = window as unknown as Record<string, unknown>;

vi.mock('./Renderer', () => ({ Renderer: vi.fn() }));

// Force the High preset so the compute default under test is deterministic —
// `detectRecommendedQuality` otherwise reads jsdom's hardware heuristics.
vi.mock('../config/visualPresets', () => ({
  detectRecommendedQuality: () => 'high',
  getPreset: () => ({ weatherPostProcessMode: 'compute' }),
}));

const MockedRenderer = Renderer as unknown as Mock;

const LIMIT_REASON = 'Adapter limit maxComputeInvocationsPerWorkgroup=128 below required 256';

/** Weather mode each constructed Renderer was asked to boot with, in order. */
let bootedModes: string[] = [];
let destroyCount = 0;

/**
 * Install a Renderer whose init succeeds only for the modes in `succeedsOn`,
 * publishing the boot probe stage a real `bootDevice` would have published.
 */
function installRenderer(succeedsOn: ReadonlyArray<string>): void {
  MockedRenderer.mockReset().mockImplementation(function (this: Record<string, unknown>, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.destroy = () => { destroyCount += 1; };
    this.setDebugOptions = vi.fn();
    this.getWeatherPostProcessMode = vi.fn().mockReturnValue('fragment');
    this.init = vi.fn().mockImplementation(async (options: { weatherPostProcessMode: string }) => {
      bootedModes.push(options.weatherPostProcessMode);
      if (succeedsOn.includes(options.weatherPostProcessMode)) {
        publishWebGpuProbe({ ok: true, stage: 'ok' });
        return true;
      }
      this.fallbackReason = LIMIT_REASON;
      publishWebGpuProbe({ ok: false, stage: 'limits', reason: LIMIT_REASON });
      return false;
    });
  });
}

describe('High-quality compute weather degrade policy', () => {
  const resetSearch = () => window.history.pushState({}, '', '/');

  beforeEach(() => {
    resetSearch();
    localStorage.clear();
    delete win.webgpuProbe;
    delete win.rendererType;
    delete win.streetViewRendererDebug;
    bootedModes = [];
    destroyCount = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    resetSearch();
    vi.restoreAllMocks();
  });

  it('boots the High preset on compute weather when the adapter can take it', async () => {
    installRenderer(['compute']);
    const created = await createStreetViewRenderer(document.createElement('canvas'));

    expect(created.backendType).toBe('webgpu');
    expect(bootedModes).toEqual(['compute']);
    expect(window.webgpuProbe?.weatherDegrade).toBeUndefined();
  });

  it('degrades once to fragment when the adapter fails the compute limit gate', async () => {
    installRenderer(['fragment']);
    const created = await createStreetViewRenderer(document.createElement('canvas'));

    expect(bootedModes).toEqual(['compute', 'fragment']);
    expect(created.backendType).toBe('webgpu');
    expect(destroyCount).toBe(1);
    expect(window.webgpuProbe?.weatherDegrade).toEqual({
      from: 'compute',
      to: 'fragment',
      reason: LIMIT_REASON,
    });
  });

  it('degrades once and only once — a failing fragment retry hard-fails', async () => {
    installRenderer([]);
    const created = await createStreetViewRenderer(document.createElement('canvas'));

    expect(bootedModes).toEqual(['compute', 'fragment']);
    expect(created.renderer).toBeNull();
    expect(created.backendType).toBeNull();
    expect(window.webgpuProbe?.ok).toBe(false);
    expect(window.webgpuProbe?.weatherDegrade).toEqual({
      from: 'compute',
      to: 'fragment',
      reason: LIMIT_REASON,
    });
  });

  it('never rescues an explicit ?weather=compute — that still hard-fails', async () => {
    window.history.pushState({}, '', '/?weather=compute');
    installRenderer(['fragment']);
    const created = await createStreetViewRenderer(document.createElement('canvas'));

    expect(bootedModes).toEqual(['compute']);
    expect(created.renderer).toBeNull();
    expect(window.webgpuProbe?.weatherDegrade).toBeUndefined();
  });

  it('never rescues a stored compute preference either', async () => {
    localStorage.setItem('streetview.weatherMode', 'compute');
    installRenderer(['fragment']);
    const created = await createStreetViewRenderer(document.createElement('canvas'));

    expect(bootedModes).toEqual(['compute']);
    expect(created.renderer).toBeNull();
  });

  it('honours ?weather=fragment over the preset default without any degrade', async () => {
    window.history.pushState({}, '', '/?weather=fragment');
    installRenderer(['fragment']);
    const created = await createStreetViewRenderer(document.createElement('canvas'));

    expect(bootedModes).toEqual(['fragment']);
    expect(created.backendType).toBe('webgpu');
    expect(window.webgpuProbe?.weatherDegrade).toBeUndefined();
  });

  it('does not degrade a non-limit boot failure', async () => {
    MockedRenderer.mockReset().mockImplementation(function (this: Record<string, unknown>) {
      this.fallbackReason = 'Could not acquire a WebGPU canvas context';
      this.destroy = () => { destroyCount += 1; };
      this.setDebugOptions = vi.fn();
      this.init = vi.fn().mockImplementation(async (options: { weatherPostProcessMode: string }) => {
        bootedModes.push(options.weatherPostProcessMode);
        publishWebGpuProbe({ ok: false, stage: 'canvas', reason: 'Could not acquire a WebGPU canvas context' });
        return false;
      });
    });

    const created = await createStreetViewRenderer(document.createElement('canvas'));

    expect(bootedModes).toEqual(['compute']);
    expect(created.renderer).toBeNull();
    expect(window.webgpuProbe?.weatherDegrade).toBeUndefined();
  });
});
