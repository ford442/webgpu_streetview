/**
 * The binaries pin their wasm feature set (cpp/CMakeLists.txt). The checker
 * that enforces it (scripts/check-wasm-features.mjs, part of check:wasm-abi)
 * must actually reject what it claims to: hand-assembled modules that use
 * reference types, tail calls, multivalue — and accept the committed ones.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script without declarations
import { checkWasmFeatures } from '../../../scripts/check-wasm-features.mjs';

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const module = (typeSec: number[], codeBody: number[]): Uint8Array =>
  Uint8Array.from([
    ...HEADER,
    ...typeSec,
    0x03, 0x02, 0x01, 0x00, // one function of type 0
    0x0a, codeBody.length + 2, 0x01, codeBody.length, ...codeBody,
  ]);
const VOID_TYPE = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00];

describe('check-wasm-features', () => {
  it('accepts a plain MVP function', () => {
    expect(checkWasmFeatures(module(VOID_TYPE, [0x00, 0x01, 0x0b]))).toEqual([]);
  });

  it('rejects reference types (ref.null func)', () => {
    const problems: string[] = checkWasmFeatures(module(VOID_TYPE, [0x00, 0xd0, 0x70, 0x1a, 0x0b]));
    expect(problems.join()).toMatch(/reference types/);
  });

  it('rejects tail calls (return_call)', () => {
    const problems: string[] = checkWasmFeatures(module(VOID_TYPE, [0x00, 0x12, 0x00, 0x0b]));
    expect(problems.join()).toMatch(/tail calls/);
  });

  it('rejects multivalue (a two-result function type)', () => {
    const twoResults = [0x01, 0x06, 0x01, 0x60, 0x00, 0x02, 0x7f, 0x7f];
    const problems: string[] = checkWasmFeatures(module(twoResults, [0x00, 0x00, 0x0b]));
    expect(problems.join()).toMatch(/multivalue/);
  });

  it.each(['streetview-wasm.simd.wasm', 'streetview-dsp.simd.wasm'])('the committed %s uses only the pinned features', (name) => {
    expect(checkWasmFeatures(readFileSync(join(process.cwd(), 'public', 'wasm', name)))).toEqual([]);
  });
});
