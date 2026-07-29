// Vitest + Testing Library matchers (CRA used Jest automatically via setupTests).
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { TextDecoder, TextEncoder } from 'util';

// CRA-era suites call jest.fn / jest.mock — alias to Vitest's vi.
(globalThis as unknown as { jest: typeof vi }).jest = vi;

// jsdom does not implement TextEncoder/TextDecoder. Keep both on the global
// object for suites whose transitive deps expect them at module-load time.
Object.assign(globalThis, { TextDecoder, TextEncoder });
