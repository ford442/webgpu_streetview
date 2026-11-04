#!/usr/bin/env node
/**
 * scripts/strip-wasm-exports.mjs <file.wasm> ...
 *
 * emcc's wasm-ld invocation hard-codes a few exports that are Emscripten
 * internals, not part of cpp/include/streetview/abi.h: the function table
 * (`--export-table`) and the stack save/restore helpers its JS glue would
 * call (`--export=_emscripten_stack_restore`, `emscripten_stack_get_current`).
 * The loader uses none of them (STANDALONE_WASM, no glue), and each export is
 * surface a host can poke at, so a post-link step removes them from the export
 * section in place. The functions stay in the module, unexported and dead;
 * only `_initialize` and the SV_EXPORT functions remain (the ABI lock test and
 * `check:wasm-abi` confirm the table). Idempotent.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export const STRIPPED_EXPORTS = new Set([
  '__indirect_function_table',
  '_emscripten_stack_restore',
  'emscripten_stack_get_current',
]);

function readU32(bytes, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = bytes[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
  }
}

function writeU32(value) {
  const out = [];
  do {
    let b = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) b |= 0x80;
    out.push(b);
  } while (value > 0);
  return out;
}

/** @param {Uint8Array} bytes @returns {Uint8Array<ArrayBuffer>} */
export function stripExports(bytes) {
  const out = [...bytes.subarray(0, 8)];
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos];
    const [size, bodyStart] = readU32(bytes, pos + 1);
    const bodyEnd = bodyStart + size;
    if (id !== 7) {
      out.push(...bytes.subarray(pos, bodyEnd));
    } else {
      const entries = [];
      let p = bodyStart;
      let n;
      [n, p] = readU32(bytes, p);
      for (; n > 0; n--) {
        const entryStart = p;
        let len;
        [len, p] = readU32(bytes, p);
        const name = new TextDecoder().decode(bytes.subarray(p, p + len));
        p += len;
        p += 1; // kind
        [, p] = readU32(bytes, p); // index
        if (!STRIPPED_EXPORTS.has(name)) entries.push(bytes.subarray(entryStart, p));
      }
      const body = [...writeU32(entries.length), ...entries.flatMap((e) => [...e])];
      out.push(7, ...writeU32(body.length), ...body);
    }
    pos = bodyEnd;
  }
  return Uint8Array.from(out);
}

import { fileURLToPath } from 'url';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of process.argv.slice(2)) {
    const before = readFileSync(file);
    const after = stripExports(before);
    if (!WebAssembly.validate(after)) throw new Error(`${file}: invalid after stripping exports`);
    writeFileSync(file, after);
    console.log(`[strip-wasm-exports] ${file}: ${before.length} -> ${after.length} B`);
  }
}
