import { test, type TestInfo } from '@playwright/test';

/**
 * The Playwright projects that launch Chromium with a real (SwiftShader)
 * WebGPU adapter: `gpu` (PR lane) and `gpu-models` (nightly, real model
 * weights). GPU specs *fail* there when there is no adapter — a lane that
 * silently skips is a lane that tests nothing — and skip everywhere else.
 */
export const WEBGPU_PROJECTS: readonly string[] = ['gpu', 'gpu-models'];

export function requireGpuAdapter(testInfo: TestInfo, fatal: unknown): void {
  const noAdapter = typeof fatal === 'string' && /no WebGPU adapter|navigator\.gpu/i.test(fatal);
  if (!noAdapter) return;
  if (WEBGPU_PROJECTS.includes(testInfo.project.name)) {
    throw new Error(
      `${testInfo.project.name} has no WebGPU adapter (${String(fatal)}) — check the SwiftShader launch flags in playwright.config.ts`,
    );
  }
  test.skip(true, 'no WebGPU adapter in this browser');
}
