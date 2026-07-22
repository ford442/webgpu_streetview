// Vitest + Testing Library matchers (CRA used Jest automatically via setupTests).
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { TextDecoder, TextEncoder } from 'util';

// CRA-era suites call jest.fn / jest.mock — alias to Vitest's vi.
(globalThis as unknown as { jest: typeof vi }).jest = vi;

// jsdom does not implement TextEncoder/TextDecoder. Cesium pulls in protobufjs,
// which expects both to be present on the global object.
Object.assign(globalThis, { TextDecoder, TextEncoder });
