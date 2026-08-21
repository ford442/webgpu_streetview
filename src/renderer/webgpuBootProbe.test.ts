import {
  detectBrowserBrand,
  isWebGpuProbeOk,
  publishWebGpuProbe,
} from './webgpuBootProbe';

describe('webgpuBootProbe', () => {
  afterEach(() => {
    delete (window as Window & { webgpuProbe?: unknown }).webgpuProbe;
  });

  describe('detectBrowserBrand', () => {
    it('prefers Edge over Chrome in userAgentData brands', () => {
      expect(
        detectBrowserBrand({
          userAgent: '',
          userAgentData: {
            brands: [
              { brand: 'Chromium', version: '120' },
              { brand: 'Microsoft Edge', version: '120' },
            ],
          },
        }),
      ).toBe('Edge');
    });

    it('detects Chrome from userAgentData', () => {
      expect(
        detectBrowserBrand({
          userAgent: '',
          userAgentData: {
            brands: [
              { brand: 'Chromium', version: '120' },
              { brand: 'Google Chrome', version: '120' },
            ],
          },
        }),
      ).toBe('Chrome');
    });

    it('falls back to UA string for Edge', () => {
      expect(
        detectBrowserBrand({
          userAgent: 'Mozilla/5.0 Edg/120.0.0.0 Chrome/120.0.0.0',
        }),
      ).toBe('Edge');
    });

    it('falls back to UA string for Chrome', () => {
      expect(
        detectBrowserBrand({
          userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
        }),
      ).toBe('Chrome');
    });
  });

  describe('publishWebGpuProbe', () => {
    it('publishes failure and success records onto window.webgpuProbe', () => {
      const failed = publishWebGpuProbe({
        ok: false,
        stage: 'adapter',
        reason: 'No compatible WebGPU adapter found',
        preference: 'auto',
        webglPreferenceDeferred: false,
        browserBrand: 'Edge',
        now: 1,
      });
      expect(window.webgpuProbe).toEqual(failed);
      expect(isWebGpuProbeOk()).toBe(false);

      const ok = publishWebGpuProbe({
        ok: true,
        stage: 'ok',
        preference: 'auto',
        browserBrand: 'Chrome',
        now: 2,
      });
      expect(window.webgpuProbe?.ok).toBe(true);
      expect(window.webgpuProbe?.browserBrand).toBe('Chrome');
      expect(isWebGpuProbeOk()).toBe(true);
      expect(ok.stage).toBe('ok');
    });

    it('preserves webglPreferenceDeferred across updates when omitted', () => {
      publishWebGpuProbe({
        ok: false,
        stage: 'navigator',
        preference: 'webgl',
        webglPreferenceDeferred: true,
        browserBrand: 'Chrome',
      });
      publishWebGpuProbe({
        ok: false,
        stage: 'adapter',
        reason: 'No adapter',
        browserBrand: 'Chrome',
      });
      expect(window.webgpuProbe?.webglPreferenceDeferred).toBe(true);
      expect(window.webgpuProbe?.preference).toBe('webgl');
    });
  });
});
