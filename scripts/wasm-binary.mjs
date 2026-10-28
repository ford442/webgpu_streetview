/**
 * scripts/wasm-binary.mjs
 *
 * Just enough of a WebAssembly binary reader to lock the ABI by *signature*:
 * the type, import, function, export and code sections, and an opcode walk
 * over every function body (to prove the worklet binary has no memory.grow).
 * No dependencies — used by scripts/check-wasm-abi.mjs and
 * src/wasm/__tests__/wasmAbiLock.test.ts.
 *
 *   import { readWasmModule, exportSignatures, countOpcodes } from './wasm-binary.mjs';
 */

const VALTYPES = new Map([
  [0x7f, 'i32'],
  [0x7e, 'i64'],
  [0x7d, 'f32'],
  [0x7c, 'f64'],
  [0x7b, 'v128'],
  [0x70, 'funcref'],
  [0x6f, 'externref'],
]);

class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes, pos = 0, end = bytes.length) {
    this.bytes = bytes;
    this.pos = pos;
    this.end = end;
  }

  byte() {
    if (this.pos >= this.end) throw new Error(`wasm: read past the end at ${this.pos}`);
    return this.bytes[this.pos++];
  }

  /** Unsigned LEB128 (u32). */
  u32() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
  }

  /** Skip a signed LEB128 of any width (s32 / s33 / s64). */
  skipLeb() {
    while (this.byte() & 0x80);
  }

  skip(n) {
    this.pos += n;
  }

  valtype() {
    const b = this.byte();
    const t = VALTYPES.get(b);
    if (!t) throw new Error(`wasm: unknown value type 0x${b.toString(16)}`);
    return t;
  }

  name() {
    const n = this.u32();
    const text = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return text;
  }
}

/**
 * @typedef {{ params: string[], results: string[] }} FuncType
 * @typedef {{
 *   types: FuncType[],
 *   importedFuncs: { module: string, name: string, type: number }[],
 *   funcTypes: number[],
 *   exports: { name: string, kind: number, index: number }[],
 *   bodies: { start: number, end: number }[],
 *   bytes: Uint8Array,
 * }} WasmModule
 */

/**
 * Parse the sections the ABI checks need. Unknown/custom sections are skipped.
 * @param {Uint8Array | ArrayBuffer} input
 * @returns {WasmModule}
 */
export function readWasmModule(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error('wasm: bad magic');
  }
  const r = new Reader(bytes, 8);
  /** @type {WasmModule} */
  const mod = { types: [], importedFuncs: [], funcTypes: [], exports: [], bodies: [], bytes };
  while (r.pos < r.end) {
    const id = r.byte();
    const size = r.u32();
    const s = new Reader(bytes, r.pos, r.pos + size);
    r.skip(size);
    if (id === 1) {
      for (let n = s.u32(); n > 0; n--) {
        const form = s.byte();
        if (form !== 0x60) throw new Error(`wasm: unsupported type form 0x${form.toString(16)}`);
        const params = [];
        for (let p = s.u32(); p > 0; p--) params.push(s.valtype());
        const results = [];
        for (let p = s.u32(); p > 0; p--) results.push(s.valtype());
        mod.types.push({ params, results });
      }
    } else if (id === 2) {
      for (let n = s.u32(); n > 0; n--) {
        const module = s.name();
        const name = s.name();
        const kind = s.byte();
        if (kind === 0) mod.importedFuncs.push({ module, name, type: s.u32() });
        else if (kind === 1) { s.byte(); limits(s); } // table: reftype + limits
        else if (kind === 2) limits(s);
        else if (kind === 3) { s.byte(); s.byte(); } // global: valtype + mut
        else throw new Error(`wasm: unknown import kind ${kind}`);
      }
    } else if (id === 3) {
      for (let n = s.u32(); n > 0; n--) mod.funcTypes.push(s.u32());
    } else if (id === 7) {
      for (let n = s.u32(); n > 0; n--) {
        const name = s.name();
        const kind = s.byte();
        mod.exports.push({ name, kind, index: s.u32() });
      }
    } else if (id === 10) {
      for (let n = s.u32(); n > 0; n--) {
        const len = s.u32();
        mod.bodies.push({ start: s.pos, end: s.pos + len });
        s.skip(len);
      }
    }
  }
  return mod;
}

function limits(s) {
  const flags = s.byte();
  s.u32();
  if (flags & 1) s.u32();
}

/**
 * Every exported function's signature, by export name.
 * @param {WasmModule} mod
 * @returns {Map<string, FuncType>}
 */
export function exportSignatures(mod) {
  const out = new Map();
  for (const e of mod.exports) {
    if (e.kind !== 0) continue;
    const typeIndex = e.index < mod.importedFuncs.length
      ? mod.importedFuncs[e.index].type
      : mod.funcTypes[e.index - mod.importedFuncs.length];
    out.set(e.name, mod.types[typeIndex]);
  }
  return out;
}

/** `(i32, f32) -> f64` */
export function formatSignature(sig) {
  return `(${sig.params.join(', ')}) -> ${sig.results.length ? sig.results.join(', ') : 'void'}`;
}

// 0xFD (SIMD) sub-opcodes by immediate shape; everything else has none.
const SIMD_MEMARG = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 92, 93]);
const SIMD_MEMARG_LANE = new Set([84, 85, 86, 87, 88, 89, 90, 91]);

/**
 * Walk every instruction of every function body and count the opcodes named
 * in `wanted` ('memory.grow', 'memory.size', 'memory.fill', 'memory.copy',
 * 'trunc_sat', 'simd'). Throws on an opcode it does not know, so a new
 * proposal in the binary fails loudly instead of being mis-skipped.
 * @param {WasmModule} mod
 * @returns {Record<string, number>}
 */
export function countOpcodes(mod) {
  const counts = { 'memory.grow': 0, 'memory.size': 0, 'memory.fill': 0, 'memory.copy': 0, trunc_sat: 0, simd: 0 };
  for (const body of mod.bodies) {
    const r = new Reader(mod.bytes, body.start, body.end);
    for (let groups = r.u32(); groups > 0; groups--) {
      r.u32();
      r.valtype();
    }
    while (r.pos < r.end) walkInstruction(r, counts);
  }
  return counts;
}

function blockType(r) {
  const b = r.bytes[r.pos];
  if (b === 0x40 || VALTYPES.has(b)) r.skip(1);
  else r.skipLeb();
}

function memarg(r) {
  const align = r.u32();
  if (align & 0x40) r.u32(); // multi-memory index
  r.u32();
}

function walkInstruction(r, counts) {
  const op = r.byte();
  if (op <= 0x01 || op === 0x05 || op === 0x0b || op === 0x0f || op === 0x1a || op === 0x1b || op === 0xd1) return;
  if (op >= 0x02 && op <= 0x04) return blockType(r);
  if (op === 0x0c || op === 0x0d || op === 0x10 || op === 0x12 || op === 0xd2) return void r.u32();
  if (op === 0x0e) {
    for (let n = r.u32(); n >= 0; n--) r.u32();
    return;
  }
  if (op === 0x11 || op === 0x13) {
    r.u32();
    r.u32();
    return;
  }
  if (op === 0x1c) {
    for (let n = r.u32(); n > 0; n--) r.valtype();
    return;
  }
  if (op >= 0x20 && op <= 0x26) return void r.u32();
  if (op >= 0x28 && op <= 0x3e) return memarg(r);
  if (op === 0x3f) {
    counts['memory.size']++;
    return void r.u32();
  }
  if (op === 0x40) {
    counts['memory.grow']++;
    return void r.u32();
  }
  if (op === 0x41 || op === 0x42) return r.skipLeb();
  if (op === 0x43) return r.skip(4);
  if (op === 0x44) return r.skip(8);
  if (op >= 0x45 && op <= 0xc4) return;
  if (op === 0xd0) return r.skip(1);
  if (op === 0xfc) {
    const sub = r.u32();
    if (sub <= 7) {
      counts.trunc_sat++;
      return;
    }
    if (sub === 8) { r.u32(); r.u32(); return; }
    if (sub === 9 || sub === 13 || (sub >= 15 && sub <= 17)) return void r.u32();
    if (sub === 10) {
      counts['memory.copy']++;
      r.u32();
      r.u32();
      return;
    }
    if (sub === 11) {
      counts['memory.fill']++;
      return void r.u32();
    }
    if (sub === 12 || sub === 14) { r.u32(); r.u32(); return; }
    throw new Error(`wasm: unknown 0xfc sub-opcode ${sub}`);
  }
  if (op === 0xfd) {
    counts.simd++;
    const sub = r.u32();
    if (SIMD_MEMARG.has(sub)) return memarg(r);
    if (sub === 12 || sub === 13) return r.skip(16);
    if (sub >= 21 && sub <= 34) return r.skip(1);
    if (SIMD_MEMARG_LANE.has(sub)) {
      memarg(r);
      r.skip(1);
      return;
    }
    return;
  }
  throw new Error(`wasm: unknown opcode 0x${op.toString(16)} at ${r.pos - 1}`);
}
