// Vitest + Testing Library matchers (CRA used Jest automatically via setupTests).
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto'; // offline layer (IndexedDB) works under jsdom/node instead of logging `indexedDB is not defined`
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TextDecoder, TextEncoder } from 'util';
import { _installWasmModule, instantiateStreetViewWasm } from './wasm';

// CRA-era suites call jest.fn / jest.mock — alias to Vitest's vi.
(globalThis as unknown as { jest: typeof vi }).jest = vi;

// jsdom does not implement TextEncoder/TextDecoder. Keep both on the global
// object for suites whose transitive deps expect them at module-load time.
Object.assign(globalThis, { TextDecoder, TextEncoder });

// The committed binary is the only implementation of every kernel, in tests
// too: instantiate it (Node has no server for public/wasm/) and install it as
// the module, the way src/index.tsx loads it before the app renders.
_installWasmModule(
  await instantiateStreetViewWasm(readFileSync(join(process.cwd(), 'public', 'wasm', 'streetview-wasm.simd.wasm'))),
);
