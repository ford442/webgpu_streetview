import { defineConfig, devices } from '@playwright/test';

/**
 * Side-by-side Playwright E2E (not CRA's experimental e2e).
 *
 * - Smoke (PR CI): UI shell without a Maps key — `npx playwright test --grep-invert @keyed`
 * - Keyed (nightly): full suite including hold-pause — needs REACT_APP_MAPS_API_KEY
 *
 * Web server: prefers an already-running `npm start` / static server when
 * `reuseExistingServer` allows it; otherwise starts Vite with host binding.
 */
const PORT = Number(process.env.E2E_PORT || 3000);
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const hasMapsKey = Boolean(
  process.env.REACT_APP_MAPS_API_KEY &&
    !/placeholder|your_|replace|example/i.test(process.env.REACT_APP_MAPS_API_KEY),
);

/**
 * What yields a real WebGPU adapter in headless Chromium on a GPU-less runner,
 * one that can also present to a canvas: SwiftShader's Vulkan backend under
 * Dawn (it exposes `clip-distances`, which the windshield portal needs). Without these the GPU specs would have
 * no adapter and — before the `chromium-webgpu` lane — quietly skip.
 */
const SWIFTSHADER_WEBGPU_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  // Without this the first present to a WebGPU *canvas* loses the device ("A
  // valid external Instance reference no longer exists"); the offscreen-only
  // windshield fixtures never presented, so they never noticed.
  '--use-vulkan=swiftshader',
  '--use-angle=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  // No `--disable-vulkan-surface`: with it the canvas never reaches the
  // compositor, and a screenshot of a presented frame is blank.
];

/** Specs that need a real GPU device; they run (and must not skip) in `chromium-webgpu`. */
const GPU_SPECS = /(gpu-foundation|windshield-portal)\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: GPU_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--ignore-gpu-blocklist',
            '--enable-unsafe-webgpu',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--no-sandbox',
            '--disable-setuid-sandbox',
          ],
        },
      },
    },
    {
      // The real-GPU lane. `e2e/gpuLane.ts#requireGpuAdapter` turns "no
      // adapter" into a failure here, so this project can never go green by
      // skipping. `channel: 'chromium'` runs the full browser in new headless
      // mode rather than the headless shell.
      name: 'chromium-webgpu',
      testMatch: GPU_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: { args: SWIFTSHADER_WEBGPU_ARGS },
      },
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        // Bind IPv4 explicitly — `npm start` / Vite `localhost` can listen on
        // ::1 only, which never answers Playwright's http://127.0.0.1:3000 check.
        command: `npx vite --host 127.0.0.1 --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          ...process.env,
          BROWSER: 'none',
          PORT: String(PORT),
          // In CI smoke, force an empty key so missing-key UI is deterministic.
          // Locally, leave unset so .env.local can supply a key when present.
          ...(process.env.CI && !hasMapsKey ? { REACT_APP_MAPS_API_KEY: '' } : {}),
          ...(hasMapsKey ? { REACT_APP_MAPS_API_KEY: process.env.REACT_APP_MAPS_API_KEY! } : {}),
          CI: 'false',
        },
      },
});
