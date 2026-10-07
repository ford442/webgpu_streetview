import { test, type TestInfo } from '@playwright/test';

/**
 * The Playwright project that launches Chromium with a real (SwiftShader)
 * WebGPU adapter. GPU specs *fail* there when there is no adapter — a lane
 * that silently skips is a lane that tests nothing — and skip everywhere else.
 */
export const WEBGPU_PROJECT = 'chromium-webgpu';

export function requireGpuAdapter(testInfo: TestInfo, fatal: unknown): void {
  const noAdapter = typeof fatal === 'string' && /no WebGPU adapter|navigator\.gpu/i.test(fatal);
  if (!noAdapter) return;
  if (testInfo.project.name === WEBGPU_PROJECT) {
    throw new Error(
      `${WEBGPU_PROJECT} has no WebGPU adapter (${String(fatal)}) — check the SwiftShader launch flags in playwright.config.ts`,
    );
  }
  test.skip(true, 'no WebGPU adapter in this browser');
}
