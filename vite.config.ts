import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import publicEnvKeys from './scripts/public-env-keys.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

/**
 * Build-time env keys that may be inlined into the client bundle (single source of
 * truth: scripts/public-env-keys.json, also read by scripts/check-build-env-leak.mjs).
 * Everything here is visible to any visitor — never add a secret.
 */
const PUBLIC_ENV_KEYS: string[] = publicEnvKeys;

/**
 * CRA → Vite migration config.
 * - base './' keeps Contabo /streetview relative asset paths (former homepage: ".")
 * - outDir build/ + static/js/main.[hash].js preserves deploy.py key baking
 * - Allowlisted REACT_APP_* / VITE_* keys surfaced as import.meta.env.VITE_PUBLIC_*
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['REACT_APP_', 'VITE_']);
  const buildVersion = env.REACT_APP_BUILD_VERSION || env.VITE_BUILD_VERSION || gitShortHash();
  const buildTime =
    env.REACT_APP_BUILD_TIME ||
    env.VITE_BUILD_TIME ||
    `${new Date().toISOString().replace('T', ' ').substring(0, 16)} UTC`;

  // Build-time config reaches src/ only as `import.meta.env.VITE_PUBLIC_*`.
  // Only allowlisted, client-visible keys are surfaced. A blanket loop over every
  // REACT_APP_* / VITE_* var would bake any stray secret in a developer's .env
  // into the public bundle. Add a key to scripts/public-env-keys.json only when
  // src/ reads it AND it is safe to ship to every visitor. The Cesium Ion token is
  // intentionally absent: it is supplied at runtime via public/config.js.
  // `REACT_APP_X` and `VITE_X` collapse to one `VITE_PUBLIC_X` (the VITE_ spelling
  // wins); every name is always set (empty) so reads never see `undefined`.
  // Vite loads `envPrefix` vars from process.env after this function returns, so
  // setting them here covers `vite`, `vite build` and vitest alike.
  const publicEnv: Record<string, string> = {
    VITE_PUBLIC_BUILD_VERSION: buildVersion,
    VITE_PUBLIC_BUILD_TIME: buildTime,
  };
  for (const key of PUBLIC_ENV_KEYS) {
    const rest = key.replace(/^(REACT_APP|VITE)_/, '');
    const name = `VITE_PUBLIC_${rest}`;
    // The VITE_ spelling first, but only if it is itself on the allowlist.
    const twin = `VITE_${rest}`;
    publicEnv[name] ||= (PUBLIC_ENV_KEYS.includes(twin) && env[twin]) || env[key] || '';
  }
  for (const [name, value] of Object.entries(publicEnv)) process.env[name] = value;

  return {
    base: './',
    publicDir: 'public',
    plugins: [
      react(),
      // Typecheck in CI via `npm run typecheck`; skip overlay during vitest.
      ...(process.env.VITEST
        ? []
        : [
            checker({
              typescript: { tsconfigPath: 'tsconfig.app.json' },
              overlay: { initialIsOpen: false },
            }),
          ]),
    ],
    // Vite inlines EVERY variable with these prefixes wherever `import.meta.env` is
    // referenced as an object (some dependencies do), so this must stay an opt-in
    // namespace nothing else uses. It is populated only from the allowlist above.
    envPrefix: ['VITE_PUBLIC_'],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      // Playwright smoke polls http://127.0.0.1:3000. Default Vite `localhost`
      // can bind IPv6-only on GitHub runners, so the health check never
      // succeeds (e2e-smoke then times out after the TS checker reports 0 errors).
      host: '127.0.0.1',
      strictPort: true,
      open: false,
    },
    preview: {
      port: 3000,
      strictPort: true,
    },
    // The scene-depth Worker (renderer/depth/depthWorker.ts) is an ES module:
    // it imports onnxruntime-web from a pinned CDN URL at run time, which an
    // IIFE worker cannot. It is a few KB — the runtime never enters the bundle.
    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          entryFileNames: 'static/js/[name].[hash].worker.js',
          chunkFileNames: 'static/js/[name].[hash].worker-chunk.js',
        },
      },
    },
    build: {
      outDir: 'build',
      // The app cannot run without WebGPU, so there is no point down-levelling for
      // older engines: Chrome/Edge 113 (first WebGPU), Firefox 141, Safari 26.
      target: ['chrome113', 'edge113', 'firefox141', 'safari26'],
      emptyOutDir: true,
      sourcemap: true,
      // Match former CRA layout so deploy.py / verify-build / budgets keep working.
      rollupOptions: {
        output: {
          entryFileNames: 'static/js/main.[hash].js',
          chunkFileNames: 'static/js/[name].[hash].chunk.js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || '';
            if (name.endsWith('.css')) {
              return 'static/css/[name].[hash][extname]';
            }
            return 'static/media/[name].[hash][extname]';
          },
        },
      },
    },
    test: {
      globals: true,
      // Pure math/GPU-packing suites pay nothing; DOM suites opt in with
      // `// @vitest-environment jsdom` on their first line.
      environment: 'node',
      setupFiles: ['./src/setupTests.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['node_modules', 'build', 'e2e'],
      // Match former CRA jest resetMocks: clear call history but keep implementations.
      clearMocks: true,
      restoreMocks: false,
      mockReset: false,
      pool: 'forks',
      server: {
        deps: {
          // Cesium / protobufjs need Node util polyfills from setupTests.
          inline: [],
        },
      },
    },
  };
});
