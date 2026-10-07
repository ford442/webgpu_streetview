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
 * - Allowlisted REACT_APP_* / VITE_* keys injected via process.env.* define (compat shim)
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['REACT_APP_', 'VITE_']);
  const buildVersion = env.REACT_APP_BUILD_VERSION || env.VITE_BUILD_VERSION || gitShortHash();
  const buildTime =
    env.REACT_APP_BUILD_TIME ||
    env.VITE_BUILD_TIME ||
    `${new Date().toISOString().replace('T', ' ').substring(0, 16)} UTC`;

  const processEnvDefines: Record<string, string> = {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    // Relative public URL for subpath deploy (shaders, wasm, service worker).
    'process.env.PUBLIC_URL': JSON.stringify('.'),
    'process.env.REACT_APP_BUILD_VERSION': JSON.stringify(buildVersion),
    'process.env.REACT_APP_BUILD_TIME': JSON.stringify(buildTime),
  };

  // Only allowlisted, client-visible keys are inlined. A blanket loop over every
  // REACT_APP_* / VITE_* var would bake any stray secret in a developer's .env
  // into the public bundle. Add a key here only when src/ reads it AND it is safe
  // to ship to every visitor. The Cesium Ion token is intentionally absent: it is
  // supplied at runtime via public/config.js (window.CESIUM_ION_TOKEN).
  for (const key of PUBLIC_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) {
      processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
    }
  }
  // Always defined (empty) so `process.env.X` reads never hit a ReferenceError in
  // the browser and the runtime config.js path stays reachable.
  for (const key of ['REACT_APP_CESIUM_ION_TOKEN']) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify('');
  }

  // Ensure Maps key define exists even when unset (empty string) so the deploy
  // sentinel path in mapsKeyUtils stays reachable.
  if (!('process.env.REACT_APP_MAPS_API_KEY' in processEnvDefines)) {
    processEnvDefines['process.env.REACT_APP_MAPS_API_KEY'] = JSON.stringify('');
  }
  if (!('process.env.VITE_MAPS_API_KEY' in processEnvDefines)) {
    processEnvDefines['process.env.VITE_MAPS_API_KEY'] = JSON.stringify('');
  }
  // Same reachable-define guarantee for the Supabase signaling config (Shared
  // Exploration Sessions room-code relay) — see src/services/signaling/supabaseConfig.ts.
  for (const key of [
    'REACT_APP_SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'REACT_APP_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ]) {
    if (!(`process.env.${key}` in processEnvDefines)) {
      processEnvDefines[`process.env.${key}`] = JSON.stringify('');
    }
  }

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
              typescript: true,
              overlay: { initialIsOpen: false },
            }),
          ]),
    ],
    define: processEnvDefines,
    // Vite inlines EVERY variable with these prefixes wherever `import.meta.env` is
    // referenced as an object (some dependencies do), so this must stay an opt-in
    // namespace nothing else uses. Build-time config reaches src/ only through the
    // allowlisted `process.env.*` defines above.
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
    build: {
      outDir: 'build',
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
      environment: 'jsdom',
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
