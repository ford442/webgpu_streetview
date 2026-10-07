/// <reference types="vitest/globals" />
// Test-only ambient types. Included by tsconfig.test.json and excluded from the app
// project, so application code cannot accidentally depend on `describe`/`vi`/`jest`.

declare global {
  // Jest-compat alias installed in setupTests for CRA-era tests.
  var jest: typeof import('vitest').vi;
}

export {};
