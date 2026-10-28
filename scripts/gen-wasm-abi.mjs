#!/usr/bin/env node
/**
 * scripts/gen-wasm-abi.mjs
 *
 * cpp/include/streetview/abi.h → src/wasm/abi.generated.ts: every
 * `SV_EXPORT(name)` declaration becomes one row of the ABI table (wasm param
 * and result types, the binaries that export it) and one typed method of
 * `StreetViewWasmExports`, which is what the loader and the cabin worklet bind.
 *
 *   npm run gen:wasm-abi            # rewrite src/wasm/abi.generated.ts
 *   node scripts/gen-wasm-abi.mjs --check   # exit 1 when it is stale
 *
 * scripts/check-wasm-abi.mjs and wasmAbiLock.test.ts use `parseAbiHeader` to
 * compare the same table against each binary's type section, so a parameter
 * type changed in abi.h fails `npm run verify` until the generated file, the
 * loader's call sites and the committed binaries all agree.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ABI_HEADER = 'cpp/include/streetview/abi.h';
export const ABI_GENERATED = 'src/wasm/abi.generated.ts';

/** C type → wasm32 value type. Pointers are i32 offsets into linear memory. */
const SCALARS = new Map([
  ['int', 'i32'],
  ['unsigned int', 'i32'],
  ['unsigned', 'i32'],
  ['int32_t', 'i32'],
  ['uint32_t', 'i32'],
  ['size_t', 'i32'],
  ['uintptr_t', 'i32'],
  ['float', 'f32'],
  ['double', 'f64'],
]);

/** @param {string} type */
function wasmType(type, where) {
  const t = type.replace(/\bconst\b/g, '').replace(/\s+/g, ' ').trim();
  if (t.endsWith('*')) return 'i32';
  const v = SCALARS.get(t);
  if (!v) throw new Error(`${where}: type "${type}" is not one gen-wasm-abi.mjs maps (see abi.h)`);
  return v;
}

/**
 * The CMake source lists, so each export knows which binaries link its TU.
 * @returns {{ main: string[], dsp: string[] }}
 */
function readSourceLists(root) {
  const cmake = readFileSync(join(root, 'cpp/CMakeLists.txt'), 'utf8');
  const list = (name) => {
    const m = cmake.match(new RegExp(`set\\(${name}\\s+([^)]*)\\)`));
    if (!m) throw new Error(`cpp/CMakeLists.txt: no set(${name} ...)`);
    return m[1].split(/\s+/).filter((s) => s.endsWith('.cpp')).map((s) => s.replace(/^src\//, ''));
  };
  return { main: list('STREETVIEW_SOURCES'), dsp: list('STREETVIEW_DSP_SOURCES') };
}

/**
 * @typedef {{
 *   name: string, symbol: string, decl: string,
 *   params: { type: string, name: string, wasm: string }[],
 *   result: string | null, unit: string, binaries: ('main' | 'dsp')[],
 * }} AbiExport
 */

/**
 * Parse abi.h (and find each export's defining TU under cpp/src/).
 * @returns {AbiExport[]}
 */
export function parseAbiHeader(root = repoRoot) {
  const header = readFileSync(join(root, ABI_HEADER), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const lists = readSourceLists(root);
  const sources = new Map(
    lists.main.map((unit) => [unit, readFileSync(join(root, 'cpp/src', unit), 'utf8')]),
  );
  /** @type {AbiExport[]} */
  const out = [];
  for (const m of header.matchAll(/SV_EXPORT\((\w+)\)\s*([^;{]+);/g)) {
    const name = m[1];
    const decl = m[2].replace(/\bSW_NODISCARD\b/g, '').replace(/\s+/g, ' ').trim();
    const d = decl.match(/^(.*?)\b(\w+)\s*\((.*)\)$/);
    if (!d) throw new Error(`${ABI_HEADER}: cannot parse the declaration of ${name}: ${decl}`);
    const [, ret, symbol, args] = d;
    const where = `${ABI_HEADER} ${name}`;
    const params = args.trim() === 'void' || args.trim() === ''
      ? []
      : args.split(',').map((raw) => {
          const p = raw.trim().match(/^(.*?)(\w+)$/);
          if (!p || !p[1].trim()) throw new Error(`${where}: name every parameter ("${raw.trim()}")`);
          return { type: p[1].trim(), name: p[2], wasm: wasmType(p[1], where) };
        });
    const retType = ret.trim();
    const unit = [...sources].find(([, text]) => new RegExp(`\\b${symbol}\\s*\\([^;]*\\)\\s*\\{`).test(text))?.[0];
    if (!unit) throw new Error(`${where}: no definition of ${symbol} in the STREETVIEW_SOURCES TUs`);
    /** @type {('main' | 'dsp')[]} */
    const binaries = ['main'];
    if (lists.dsp.includes(unit)) binaries.push('dsp');
    out.push({
      name,
      symbol,
      decl: `${retType} ${symbol}(${args.trim()})`,
      params,
      result: retType === 'void' ? null : wasmType(retType, where),
      unit,
      binaries,
    });
  }
  if (out.length === 0) throw new Error(`${ABI_HEADER}: no SV_EXPORT declarations`);
  const seen = new Set();
  for (const e of out) {
    if (seen.has(e.name)) throw new Error(`${ABI_HEADER}: ${e.name} is exported twice`);
    seen.add(e.name);
  }
  return out;
}

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const TS_RESERVED = new Set(['in', 'out', 'function', 'default', 'new', 'delete']);
const tsParam = (n) => {
  const c = camel(n);
  return TS_RESERVED.has(c) ? `${c}_` : c;
};

/** The generated TypeScript module, as text. */
export function generateAbiModule(root = repoRoot) {
  const abi = parseAbiHeader(root);
  const L = [];
  L.push('/**');
  L.push(` * GENERATED by scripts/gen-wasm-abi.mjs from ${ABI_HEADER} — do not edit.`);
  L.push(' * `npm run gen:wasm-abi` regenerates it; wasmAbiLock.test.ts fails when it is');
  L.push(' * stale, and scripts/check-wasm-abi.mjs compares every row with the type');
  L.push(" * section of the binaries that export it.");
  L.push(' */');
  L.push('');
  L.push("/** A wasm value type, as a binary's type section spells it. */");
  L.push("export type WasmValType = 'i32' | 'i64' | 'f32' | 'f64';");
  L.push('');
  L.push("/** `main`: streetview-wasm.simd.wasm (and the scalar reference); `dsp`: streetview-dsp.simd.wasm. */");
  L.push("export type WasmBinaryKind = 'main' | 'dsp';");
  L.push('');
  L.push('export interface WasmExportSignature {');
  L.push('  readonly params: readonly WasmValType[];');
  L.push('  readonly results: readonly WasmValType[];');
  L.push('  readonly binaries: readonly WasmBinaryKind[];');
  L.push('}');
  L.push('');
  L.push('/** Every export of the ABI, in abi.h order. */');
  L.push('export const WASM_ABI = {');
  for (const e of abi) {
    const params = e.params.map((p) => `'${p.wasm}'`).join(', ');
    const results = e.result ? `'${e.result}'` : '';
    const bins = e.binaries.map((b) => `'${b}'`).join(', ');
    L.push(`  ${e.name}: { params: [${params}], results: [${results}], binaries: [${bins}] },`);
  }
  L.push('} as const satisfies Record<string, WasmExportSignature>;');
  L.push('');
  L.push('export type WasmExportName = keyof typeof WASM_ABI;');
  L.push('');
  L.push('/**');
  L.push(' * The raw exports, typed from the C declarations. Pointers are byte offsets');
  L.push(' * into `memory` (i32); every number crosses as a JS number.');
  L.push(' */');
  L.push('export interface StreetViewWasmExports {');
  for (const e of abi) {
    L.push(`  /** \`${e.decl}\` (${e.unit}) */`);
    const ps = e.params.map((p) => `${tsParam(p.name)}: number`).join(', ');
    L.push(`  ${e.name}(${ps}): ${e.result ? 'number' : 'void'};`);
  }
  L.push('}');
  L.push('');
  const dsp = abi.filter((e) => e.binaries.includes('dsp')).map((e) => `'${e.name}'`);
  L.push('/** What streetview-dsp.simd.wasm exports (the cabin worklet binds exactly these). */');
  L.push(`export const DSP_EXPORT_NAMES = [${dsp.join(', ')}] as const;`);
  L.push('');
  L.push('export type StreetViewDspExports = Pick<StreetViewWasmExports, (typeof DSP_EXPORT_NAMES)[number]>;');
  L.push('');
  return L.join('\n');
}

const thisFile = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === thisFile) {
  const text = generateAbiModule();
  const target = join(repoRoot, ABI_GENERATED);
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      // missing counts as stale
    }
    if (current !== text) {
      console.error(`❌ ${ABI_GENERATED} is stale — run npm run gen:wasm-abi`);
      process.exit(1);
    }
    console.log(`✅ ${ABI_GENERATED} matches ${ABI_HEADER}`);
  } else {
    writeFileSync(target, text);
    console.log(`wrote ${ABI_GENERATED} (${parseAbiHeader().length} exports)`);
  }
}
