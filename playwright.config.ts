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

/**
 * Production-mode smoke (#384): `E2E_PROD=1` swaps the dev lanes for the one `prod` project,
 * which runs `e2e/prod/` against the BUILT app — `vite preview` of `build/` by default, or a
 * deployed site when `E2E_BASE_URL` is an absolute non-loopback URL (live mode). Normally
 * driven by `npm run test:e2e:prod` / `scripts/e2e-prod.mjs`; see docs/PRODUCTION_SMOKE.md.
 */
const PROD = process.env.E2E_PROD === '1';
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT || 4173);
/** A site that is not this machine: no web server is started and the specs respect `callBudget`. */
const LIVE_URL = (() => {
  const raw = process.env.E2E_BASE_URL;
  if (!PROD || !raw) return null;
  const url = new URL(raw);
  return /^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname) ? null : url;
})();
/** Trailing slash on purpose: the prod specs resolve relative paths (`./?cabin=webgl`) against it, so a sub-path deploy works. */
const PROD_BASE_URL = LIVE_URL
  ? `${LIVE_URL.origin}${LIVE_URL.pathname.replace(/\/?$/, '/')}`
  : process.env.E2E_BASE_URL
    ? process.env.E2E_BASE_URL.replace(/\/?$/, '/')
    : `http://127.0.0.1:${PREVIEW_PORT}/streetview/`;

const hasMapsKey = Boolean(
  process.env.REACT_APP_MAPS_API_KEY &&
    !/placeholder|your_|replace|example/i.test(process.env.REACT_APP_MAPS_API_KEY),
);

/**
 * What yields a real WebGPU adapter in headless Chromium on a GPU-less runner,
 * one that can also present to a canvas: SwiftShader's Vulkan backend under
 * Dawn (it exposes `clip-distances`, which the windshield portal needs). Without these the GPU specs would have
 * no adapter and — before the `gpu` lane — quietly skip.
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

/**
 * Specs that need a real GPU device; they run (and must not skip) in `gpu`.
 * Boot, passes, portal, stereo, render scale, broken-shader isolation, the
 * atmosphere LUTs, the temporal resolve: each finishes in seconds on
 * SwiftShader, so this is the PR lane (`ci.yml`).
 */
const GPU_SPECS = /(gpu-foundation|windshield-portal|stereo|atmosphere|temporal)\.spec\.ts$/;

/**
 * Specs that run the real scene models (depth #320, semantic #352). One Depth
 * Anything inference takes ~220 s on SwiftShader, so these run only in the
 * nightly (`nightly-probe.yml`, `--project=gpu-models`), never on a PR (#358).
 */
const GPU_MODEL_SPECS = /(scene-depth|scene-semantic)\.spec\.ts$/;

const swiftShaderWebGpu = {
  ...devices['Desktop Chrome'],
  channel: 'chromium',
  launchOptions: {
    args: SWIFTSHADER_WEBGPU_ARGS,
    // A machine whose preinstalled Chromium is not the build this Playwright pins (a sandbox,
    // a distro image) can point at it instead of downloading one. CI never sets this.
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  },
};

const prodProject = {
  // Same SwiftShader WebGPU browser as `gpu`, pointed at the production bundle.
  name: 'prod',
  testMatch: /e2e\/prod\/.*\.spec\.ts$/,
  // Live + keyed flows run minutes at hop pace; the PR lane's keyless half is seconds.
  timeout: 180_000,
  use: {
    ...swiftShaderWebGpu,
    baseURL: PROD_BASE_URL,
    // Recording needs Playwright's own ffmpeg, which a machine with a substituted Chromium may not have.
    ...(process.env.E2E_CHROMIUM_PATH ? { video: 'off' as const } : {}),
  },
};

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
  projects: PROD
    ? [prodProject]
    : [
    {
      name: 'chromium',
      testIgnore: [GPU_SPECS, GPU_MODEL_SPECS, /e2e\/prod\//],
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
      name: 'gpu',
      testMatch: GPU_SPECS,
      use: swiftShaderWebGpu,
    },
    {
      // Same browser, real model weights; nightly only (see GPU_MODEL_SPECS).
      name: 'gpu-models',
      testMatch: GPU_MODEL_SPECS,
      use: swiftShaderWebGpu,
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER || LIVE_URL
    ? undefined
    : PROD
      ? {
          // The production bundle, as built: hashed assets under a sub-path, the stamped service
          // worker, COOP/COEP from `preview.headers`. `--base` mirrors the host's `/streetview/`.
          // Host and port follow the base URL (a key's HTTP-referrer allowlist names `localhost`, not `127.0.0.1`).
          command: `npx vite preview --host ${new URL(PROD_BASE_URL).hostname} --port ${new URL(PROD_BASE_URL).port || PREVIEW_PORT} --strictPort --base /streetview/`,
          url: PROD_BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        }
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
