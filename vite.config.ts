/// <reference types="vitest/config" />
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

/**
 * CRA → Vite migration config.
 * - base './' keeps Contabo /streetview relative asset paths (former homepage: ".")
 * - outDir build/ + static/js/main.[hash].js preserves deploy.py key baking
 * - REACT_APP_* still injected via process.env.* define (compat shim)
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

  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
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
    envPrefix: ['VITE_', 'REACT_APP_'],
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
