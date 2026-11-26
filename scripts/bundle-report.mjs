#!/usr/bin/env node
/**
 * `npm run report:bundle` — the size of what a build ships, as Markdown (and JSON), so a
 * release is measured the same way every time and Issue 4 can diff against the 1.0 baseline.
 *
 *   npm run report:bundle                         Markdown to stdout (after `npm run build`)
 *   npm run report:bundle -- --json out.json      also write the numbers
 *   npm run report:bundle -- --compare docs/bundle-baseline.json     deltas against a saved baseline
 *
 * Definitions (so the numbers mean the same thing next time):
 * - gzip      `gzip -9` of the file. Applied to text-like files (js, css, html, json, wgsl, svg, wasm).
 *             Already-compressed or binary assets (png, onnx, glb, webp, ico) count as their raw size.
 * - initial   what the page needs before the app can paint: index.html, `config.js`, the CSS, the main chunk
 *             and every chunk it imports statically (build/chunk-graph.json), and the main-thread WASM
 *             (a failed load fails the boot). Shaders, LUTs, the cabin glTF and the AudioWorklet's WASM are
 *             fetched during/after boot and are listed under "Everything the Deploy uploads", not here.
 * - lazy      every other JS chunk, with its budget from scripts/chunks.json.
 * - deploy    everything the Deploy uploads (no source maps, no build diagnostics) — what deploy.py zips.
 * - models    `build/models/**.onnx`: fetched on demand at run time, never part of the initial load.
 * "transfer" is an estimate of bytes on the wire with gzip on; the host's real encoding for .wasm /
 * .wgsl is whatever Apache's mod_deflate config says (check with `curl -H 'Accept-Encoding: gzip' -I`).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
/** @param {string} name */
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const buildDir = path.resolve(root, value('--build') ?? 'build');
const TEXT = /\.(js|css|html|json|wgsl|svg|wasm|txt|md)$/;

if (!fs.existsSync(buildDir)) {
  console.error(`report:bundle: ${buildDir} does not exist — run \`npm run build\` first.`);
  process.exit(1);
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const rel = (/** @type {string} */ f) => path.relative(buildDir, f).split(path.sep).join('/');
const raw = (/** @type {string} */ f) => fs.statSync(f).size;
const wire = (/** @type {string} */ f) => (TEXT.test(f) ? zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length : raw(f));
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} kB`;
const mb = (/** @type {number} */ n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

const shipped = walk(buildDir).filter((f) => !f.endsWith('.map') && !['chunk-graph.json', 'architecture-report.html'].includes(rel(f)));
const contracts = JSON.parse(fs.readFileSync(path.join(root, 'scripts/chunks.json'), 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(buildDir, 'chunk-graph.json'), 'utf8'));
const info = fs.existsSync(path.join(buildDir, 'build-info.json')) ? JSON.parse(fs.readFileSync(path.join(buildDir, 'build-info.json'), 'utf8')) : null;

// Initial JS = the entry chunk + everything it imports statically.
const entryKey = Object.keys(graph.chunks).find((k) => graph.chunks[k].isEntry);
/** @type {Set<string>} */
const initialJs = new Set();
/** @param {string} key */
const visit = (key) => {
  if (!key || initialJs.has(key)) return;
  initialJs.add(key);
  for (const next of graph.chunks[key]?.imports ?? []) visit(next);
};
if (entryKey) visit(entryKey);
const jsKey = (/** @type {string} */ f) => rel(f); // chunk-graph keys are `static/js/<name>`

/** @type {Array<{ file: string, raw: number, gzip: number, budget: number | null }>} */
const lazy = [];
let main = { file: '', raw: 0, gzip: 0, budget: contracts.main.gzipBudgetBytes };
let initialGzip = 0;
let initialRaw = 0;
for (const f of shipped.filter((f) => /static\/js\/[^/]+\.js$/.test(f.split(path.sep).join('/')) && !f.endsWith('.worker.js'))) {
  const key = jsKey(f);
  const row = { file: key, raw: raw(f), gzip: wire(f), budget: null };
  const name = path.basename(f).replace(/\.[^.]+\.chunk\.js$/, '');
  if (initialJs.has(key) || initialJs.has(key.replace(/^static\/js\//, ''))) {
    initialGzip += row.gzip;
    initialRaw += row.raw;
  }
  if (path.basename(f).startsWith('main.')) {
    main = { ...row, budget: contracts.main.gzipBudgetBytes };
  } else {
    const specific = contracts.chunks.find((c) => c.name === name)?.gzipBudgetBytes;
    lazy.push({ ...row, budget: specific ?? contracts.defaultChunkGzipBudgetBytes });
  }
}
lazy.sort((a, b) => b.gzip - a.gzip);

const css = shipped.filter((f) => f.endsWith('.css'));
const cssGzip = css.reduce((n, f) => n + wire(f), 0);
const staticInitial = ['index.html', 'config.js'].map((n) => path.join(buildDir, n)).filter((f) => fs.existsSync(f));
const staticInitialGzip = staticInitial.reduce((n, f) => n + wire(f), 0);
const wasm = shipped.filter((f) => f.endsWith('.wasm'));
const mainWasm = wasm.filter((f) => f.endsWith('streetview-wasm.simd.wasm'));
const mainWasmGzip = mainWasm.reduce((n, f) => n + wire(f), 0);
const models = shipped.filter((f) => f.endsWith('.onnx'));
const workers = shipped.filter((f) => f.endsWith('.worker.js'));
const total = { files: shipped.length, raw: shipped.reduce((n, f) => n + raw(f), 0), wire: shipped.reduce((n, f) => n + wire(f), 0) };
const modelsWire = models.reduce((n, f) => n + wire(f), 0);

const out = {
  build: info,
  main: { raw: main.raw, gzip: main.gzip, budget: main.budget },
  initial: { jsGzip: initialGzip, jsRaw: initialRaw, cssGzip, htmlAndConfigGzip: staticInitialGzip, mainWasmGzip, total: initialGzip + cssGzip + staticInitialGzip + mainWasmGzip },
  lazy: lazy.map(({ file, raw, gzip, budget }) => ({ file, raw, gzip, budget })),
  workers: workers.map((f) => ({ file: rel(f), raw: raw(f), gzip: wire(f) })),
  wasm: wasm.map((f) => ({ file: rel(f), bytes: raw(f), gzip: wire(f) })),
  models: models.map((f) => ({ file: rel(f), bytes: raw(f) })),
  total: { files: total.files, raw: total.raw, transfer: total.wire, transferWithoutModels: total.wire - modelsWire },
};

const baselinePath = value('--compare');
/** @type {any} */
const base = baselinePath ? JSON.parse(fs.readFileSync(path.resolve(root, baselinePath), 'utf8')) : null;
const delta = (/** @type {number} */ now, /** @type {number | undefined} */ then) => (then === undefined ? '' : ` (${now - then >= 0 ? '+' : ''}${((now - then) / 1024).toFixed(1)} kB)`);

const lines = [];
lines.push(`# Bundle report${info ? ` — ${info.version} @ ${info.shortSha}${info.dirty ? ' (dirty tree)' : ''}` : ''}`, '');
lines.push(`Built ${info?.builtAt ?? '?'} · \`${info?.sha ?? 'unknown'}\``, '');
lines.push('## First load (static payload before the app can paint)', '');
lines.push('| part | gzip |', '| --- | ---: |');
lines.push(`| main JS + its static imports | ${kb(initialGzip)}${delta(initialGzip, base?.initial.jsGzip)} |`);
lines.push(`| CSS | ${kb(cssGzip)}${delta(cssGzip, base?.initial.cssGzip)} |`);
lines.push(`| index.html + config.js | ${kb(staticInitialGzip)} |`);
lines.push(`| main-thread WASM (boot needs it) | ${kb(mainWasmGzip)} |`);
lines.push(`| **initial total** | **${kb(out.initial.total)}**${delta(out.initial.total, base?.initial.total)} |`, '');
lines.push(`Main chunk alone: ${kb(main.gzip)} gzip of a ${kb(main.raw)} file — budget ${kb(main.budget)} (${((main.gzip / main.budget) * 100).toFixed(0)}% used).`, '');
lines.push('## Lazy chunks vs `scripts/chunks.json`', '');
lines.push('| chunk | gzip | budget | used |', '| --- | ---: | ---: | ---: |');
for (const c of lazy) {
  const before = base?.lazy.find((b) => b.file.replace(/\.[^.]+\.chunk\.js$/, '') === c.file.replace(/\.[^.]+\.chunk\.js$/, ''))?.gzip;
  lines.push(`| ${path.basename(c.file).replace(/\.[^.]+\.chunk\.js$/, '')} | ${kb(c.gzip)}${delta(c.gzip, before)} | ${kb(c.budget ?? 0)} | ${(((c.gzip) / (c.budget ?? 1)) * 100).toFixed(0)}% |`);
}
lines.push('', '## WASM, workers, models', '');
lines.push('| file | bytes | gzip |', '| --- | ---: | ---: |');
for (const f of [...wasm, ...workers]) lines.push(`| ${rel(f)} | ${raw(f).toLocaleString('en-US')} | ${kb(wire(f))} |`);
for (const f of models) lines.push(`| ${rel(f)} (on demand) | ${raw(f).toLocaleString('en-US')} | — |`);
lines.push('', '## Everything the Deploy uploads', '');
lines.push(`${total.files} files · ${mb(total.raw)} raw · ≈ ${mb(total.wire)} transfer with gzip (≈ ${mb(total.wire - modelsWire)} without the on-demand models).`, '');

console.log(lines.join('\n'));
const jsonOut = value('--json');
if (jsonOut) fs.writeFileSync(path.resolve(root, jsonOut), `${JSON.stringify(out, null, 2)}\n`);
