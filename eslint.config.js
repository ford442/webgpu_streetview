import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const unusedVars = [
    'error',
    {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
    },
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
            ...reactHooks.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/no-unescaped-entities': 'off',
            'react/display-name': 'off',
            'react-hooks/exhaustive-deps': 'error',
        },
    },

    // Unit tests run in node/jsdom and may touch both worlds.
    {
        files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}', 'src/setupTests.ts'],
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
