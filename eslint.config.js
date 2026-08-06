import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['build/**', 'node_modules/**', 'dist/**', 'coverage/**'],
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooks,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
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
            'no-case-declarations': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            'prefer-const': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'react-hooks/exhaustive-deps': 'off',
        },
    },
    {
        files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', 'src/setupTests.ts', 'e2e/**/*.ts'],
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
);
