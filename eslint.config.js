import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** @type {['error', Record<string, unknown>]} */
const unusedVars = [
    'error',
    {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
    },
];

// Files that predate the no-unsafe-* / unbound-method ratchet. Remove a line when
// its file is clean; never add one (a new file must pass).
const UNSAFE_BASELINE = [
    'src/car/gltfInteriorKit.ts',
    'src/car/interior/CarInteriorAssembly.ts',
    'src/car/interior/CarInteriorDispose.ts',
    'src/car/interior/CenterDisplay.ts',
    'src/car/interior/InteriorMicroInteractions.ts',
    'src/car/interior/cabinPortalMaterial.ts',
    'src/car/interior/performance.ts',
    'src/car/interior/roadFrameBinding.ts',
    'src/car/variants/limousine/LimoAtmospherePlugin.ts',
    'src/car/variants/scienceLab/ScienceLabAtmosphere.ts',
    'src/hooks/useEnvironmentSettings.tsx',
    'src/hooks/useKeyboardShortcuts.tsx',
    'src/hooks/useSharedSession.ts',
    'src/hooks/useStreetView.tsx',
    'src/hooks/useViewMode.tsx',
    'src/renderer/deviceInit.ts',
    'src/search/geocodeAuth.ts',
    'src/services/radioBrowserService.ts',
    'src/state/cabinHeadStore.ts',
    'src/state/liveConditionsStore.ts',
    'src/state/povStore.ts',
    'src/state/tripStore.ts',
    'src/trip/tripLibrary.ts',
    'src/trip/tripRecorder.ts',
    'src/trip/tripReplay.ts',
    'src/utils/historicalImagery.ts',
    'src/utils/memoryProfiler.ts',
    'src/wasm/index.ts',
];

export default tseslint.config(
    {
        ignores: [
            'build/**', 'node_modules/**', 'dist/**', 'coverage/**',
            'playwright-report/**', 'test-results/**', 'blob-report/**',
            'cpp/**', 'public/**', 'docs/**',
        ],
    },
    {
        linterOptions: {
            // A disable comment that no longer suppresses anything is a lie waiting to hide a bug.
            reportUnusedDisableDirectives: 'error',
        },
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,

    // Shared TS rules (app, tests, e2e, configs).
    {
        files: ['**/*.{ts,tsx}'],
        rules: {
            'no-case-declarations': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': unusedVars,
            '@typescript-eslint/no-unused-expressions': 'off',
            'prefer-const': 'error',
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },

    // Browser app code.
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooks,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser },
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        settings: {
            react: { version: 'detect' },
        },
        rules: {
            ...reactPlugin.configs.recommended.rules,
            // eslint-plugin-react-hooks 7 `recommended` also ships React Compiler rules
            // (refs, set-state-in-effect, purity, …). The render loops here deliberately use
            // the "latest value in a ref" pattern, so only the two classic rules are enforced.
            'react-hooks/rules-of-hooks': 'error',
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/no-unescaped-entities': 'off',
            'react/display-name': 'off',
            'react-hooks/exhaustive-deps': 'error',
            // Build config reaches src/ as `import.meta.env.VITE_PUBLIC_*` (vite.config.ts) and
            // asset URLs go through config/publicUrl.ts; there is no `process` in the browser.
            'no-restricted-properties': ['error', {
                object: 'process',
                property: 'env',
                message: 'Use import.meta.env.VITE_PUBLIC_* (see vite.config.ts) or config/publicUrl.ts.',
            }],
        },
    },

    // Type-aware rules: what `tsc` cannot see (#340 promises; #343 the rest of
    // recommended-type-checked). Scoped to src/ — type info costs a program
    // build, so configs/scripts/e2e skip it.
    ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ['src/**/*.{ts,tsx}'] })),
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Fire-and-forget has one spelling: `void promise;` (or `void fn()`), which
            // no-floating-promises accepts and no-void leaves alone. A `.catch(() => {})`
            // that swallows the error is not the convention — handle it or `void` it.
            '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: false }],
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            // Real `any` leaks. Ratchet: new code is held to these; the files in
            // UNSAFE_BASELINE below predate them and may only shrink the list.
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unsafe-call': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'error',
            '@typescript-eslint/no-unsafe-argument': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            '@typescript-eslint/unbound-method': 'error',
            // google.maps.* status/source enums are compared against their string values throughout.
            '@typescript-eslint/no-unsafe-enum-comparison': 'off',
            'no-restricted-syntax': ['error', {
                selector: "CallExpression[callee.property.name='catch'][arguments.0.type='ArrowFunctionExpression'][arguments.0.params.length=0][arguments.0.body.type='BlockStatement'][arguments.0.body.body.length=0]",
                message: 'Use `.catch(ignoreRejection)` (utils/ignoreRejection.ts) for an intentionally ignored rejection.',
            }, {
                // #361: one AudioContext for the app, with named buses.
                selector: "NewExpression[callee.name=/^(webkit)?AudioContext$/], NewExpression[callee.property.name=/^(webkit)?AudioContext$/]",
                message: 'Use acquireAudioRuntime() (audio/audioRuntime.ts) and connect to a bus — the app has one AudioContext.',
            }],
            // Empty blocks hide bugs; `catch {}` is the one allowed (see shared TS rules).
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    {
        files: UNSAFE_BASELINE,
        rules: {
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/unbound-method': 'off',
        },
    },

    // Unit tests run in node/jsdom and may touch both worlds.
    {
        files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}', 'src/setupTests.ts'],
        rules: {
            'no-restricted-properties': 'off',
            // Mocks are untyped by design: `vi.fn()` receivers, partial stubs, async fakes.
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/unbound-method': 'off',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                vi: 'readonly',
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeAll: 'readonly',
                beforeEach: 'readonly',
                afterAll: 'readonly',
                afterEach: 'readonly',
            },
        },
    },

    // Node-side tooling: configs, scripts, Playwright (e2e specs also run page.evaluate code).
    {
        files: ['*.config.{ts,js,mjs}', 'scripts/**/*.{mjs,js,ts}', 'e2e/**/*.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': unusedVars,
        },
    },
);
