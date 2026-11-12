#!/usr/bin/env node
/**
 * `npm run check:architecture` — the layering gate. Five checks:
 *
 *   1. scripts/architecture.json is whole: every top-level `src/` folder is in exactly one layer and
 *      every listed folder exists.
 *   2. dependency-cruiser (`.dependency-cruiser.mjs`): no cycle, no upward import (type-only imports
 *      count), no orphan, nothing in a layer imports `src/index.tsx` / `src/App.tsx`.
 *   3. No lazy chunk's entry (scripts/chunks.json) is *statically* reachable from `src/index.tsx`
 *      through value imports — a static value import from a main-bundle module pulls the chunk into
 *      main. Type-only and `import()` edges do not count. (The build then re-checks the result against
 *      what rollup emitted: scripts/check-chunk-graph.mjs.)
 *   4. Every `import('./app-module')` in `src/` has a contract in scripts/chunks.json, so a new lazy
 *      chunk gets a budget and a forbidden list the day it is added.
 *   5. The TypeScript projects match the layers: `tsconfig.layer-<name>.json` includes exactly its
 *      layer's folders and references exactly the layers below it, so `tsc -b` cannot see an upward
 *      import that the cruiser would not.
 *
 *   node scripts/check-architecture.mjs            check
 *   node scripts/check-architecture.mjs --report   also write build/architecture-report.html (CI artifact)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const architecture = readJson('scripts/architecture.json');
const chunks = readJson('scripts/chunks.json');
const wantReport = process.argv.includes('--report');
const failures = [];
const fail = (message) => failures.push(message);

/* 1 — architecture.json is whole. */
{
  const onDisk = fs.readdirSync(path.join(root, 'src'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const listed = architecture.layers.flatMap((l) => l.folders);
  for (const f of onDisk) if (!listed.includes(f)) fail(`src/${f}/ is in no layer — add it to scripts/architecture.json`);
  for (const f of listed) if (!onDisk.includes(f)) fail(`scripts/architecture.json lists src/${f}/, which does not exist`);
  for (const f of listed) if (listed.indexOf(f) !== listed.lastIndexOf(f)) fail(`src/${f}/ is in more than one layer`);
  for (const [pkg, { entries }] of Object.entries(architecture.packages ?? {})) {
    if (!listed.includes(pkg)) fail(`scripts/architecture.json: package "${pkg}" is not a layer folder`);
    for (const e of entries) if (!fs.existsSync(path.join(root, 'src', pkg, e))) fail(`scripts/architecture.json: package "${pkg}" entry ${e} does not exist`);
  }
}

/* 5 (declared first: cheap) — the per-layer TypeScript projects match architecture.json. */
{
  const refs = (file) => (readJson(file).references ?? []).map((r) => path.basename(r.path));
  const layerFile = (l) => `tsconfig.layer-${l.name}.json`;
  architecture.layers.forEach((layer, i) => {
    const file = layerFile(layer);
    if (!fs.existsSync(path.join(root, file))) {
      fail(`${file} is missing — every layer in scripts/architecture.json is its own TypeScript project`);
      return;
    }
    const config = readJson(file);
    const folders = (config.include ?? []).filter((g) => /^src\/[a-z]+$/.test(g)).map((g) => g.slice(4)).sort();
    if (folders.join() !== [...layer.folders].sort().join()) {
      fail(`${file} includes [${folders.join(', ')}] but layer "${layer.name}" is [${[...layer.folders].sort().join(', ')}]`);
    }
    const want = architecture.layers.slice(0, i).map((l) => layerFile(l));
    if (refs(file).join() !== want.join()) fail(`${file} references [${refs(file).join(', ')}], expected [${want.join(', ')}]`);
  });
  const top = refs('tsconfig.app.json');
  const all = architecture.layers.map((l) => `tsconfig.layer-${l.name}.json`);
  if (top.join() !== all.join()) fail(`tsconfig.app.json must reference every layer project in order: [${all.join(', ')}]`);
}

/* 2 — dependency-cruiser. */
function depcruise(extraArgs, options = {}) {
  const bin = path.join(root, 'node_modules', '.bin', 'depcruise');
  return spawnSync(bin, ['src', '--config', '.dependency-cruiser.mjs', ...extraArgs], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
}
const err = depcruise(['--output-type', 'err']);
if (err.status !== 0) {
  process.stdout.write(err.stdout);
  process.stderr.write(err.stderr);
  fail('dependency-cruiser found violations (above)');
} else {
  console.log(`✅ ${err.stdout.trim().split('\n').pop()?.replace(/^✔ /, '')}`);
}
if (wantReport) {
  const report = depcruise(['--output-type', 'err-html']);
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'architecture-report.html'), report.stdout);
  console.log('ℹ️  wrote build/architecture-report.html');
}

/* 3 — lazy entries are not statically reachable from the app entry. */
const json = depcruise(['--output-type', 'json']);
const cruised = JSON.parse(json.stdout);
const edges = new Map();
for (const m of cruised.modules) {
  const out = [];
  for (const d of m.dependencies) {
    const types = d.dependencyTypes ?? [];
    if (d.dynamic || types.includes('dynamic-import') || types.includes('type-only') || types.includes('type-import')) continue;
    if (!d.resolved.startsWith('src/')) continue;
    out.push(d.resolved);
  }
  edges.set(m.source, out);
}
const appEntry = 'src/index.tsx';
/** @type {Map<string, string | null>} */
const parent = new Map([[appEntry, null]]);
/** @type {string[]} */
const queue = [appEntry];
while (queue.length) {
  const cur = /** @type {string} */ (queue.shift());
  for (const next of edges.get(cur) ?? []) {
    if (parent.has(next)) continue;
    parent.set(next, cur);
    queue.push(next);
  }
}
for (const chunk of chunks.chunks) {
  if (!chunk.entry.startsWith('src/')) continue;
  if (!fs.existsSync(path.join(root, chunk.entry))) {
    fail(`scripts/chunks.json: chunk "${chunk.name}" entry ${chunk.entry} does not exist`);
    continue;
  }
  if (!parent.has(chunk.entry)) continue;
  /** @type {string[]} */
  const trail = [];
  /** @type {string | null | undefined} */
  let at = chunk.entry;
  while (at) {
    trail.unshift(at);
    at = parent.get(at);
  }
  fail(`lazy chunk "${chunk.name}" (${chunk.entry}) is statically reachable from ${appEntry}:\n      ${trail.join('\n      → ')}\n    Import it with import() (or import its types), never by value.`);
}

/* 4 — every import('./app-module') has a chunk contract. */
{
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const entries = new Set(chunks.chunks.map((c) => c.entry));
  const isTest = (f) => /\.(test|spec)\.tsx?$/.test(f) || f.includes('/__tests__/') || f.endsWith('setupTests.ts');
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !isTest(p) ? [p] : [];
    });
  const resolveRel = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const p = base + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.relative(root, p).split(path.sep).join('/');
    }
    return null;
  };
  for (const file of walk(path.join(root, 'src'))) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg) && arg.text.startsWith('.')) {
          const target = resolveRel(file, arg.text);
          if (target && !entries.has(target)) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            fail(`${path.relative(root, file)}:${line} import('${arg.text}') has no contract — add { "name", "entry": "${target}" } to scripts/chunks.json`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`❌ ${f}`);
  console.error(`\n${failures.length} architecture check(s) failed.`);
  process.exit(1);
}
console.log('✅ architecture: layers whole, lazy entries not statically reachable from src/index.tsx, every import() has a chunk contract');
