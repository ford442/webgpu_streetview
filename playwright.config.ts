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
