#!/usr/bin/env node
/**
 * Fetch the scene models into public/models/<model>/ — at deploy time, not into
 * git (both directories are gitignored).
 *
 *   node scripts/fetch-models.mjs                     every model, every variant missing or stale
 *   node scripts/fetch-models.mjs --model depth       scene depth only (#320; `npm run fetch:depth-model`)
 *   node scripts/fetch-models.mjs --model semantic    the semantic segmenter only (#352)
 *   node scripts/fetch-models.mjs --model depth --variant q4f16
 *   node scripts/fetch-models.mjs --check             exit 1 unless every file is present and verified
 *
 * One manifest per model, the same file the app reads:
 * - depth: src/renderer/depth/depthModel.manifest.json — files served as
 *   downloaded (Hugging Face revision, size, SHA-256 pinned).
 * - semantic: src/renderer/semantic/semanticModel.manifest.json — the source
 *   archive is pinned, then REBUILT here (scripts/lib/onnxSurgery.mjs:
 *   ImageNet input, any size, fp16-stored weights, the app's 7-class head) and
 *   the rebuilt file is pinned too, so the browser verifies exactly what this
 *   script produced. `--print-pins` prints the rebuilt file's size and hash.
 *
 * Every file is written to a temp name, verified, then renamed into place, so a
 * failed or tampered download never leaves a file the app would serve. A
 * NOTICE.txt with the model's licence is written beside each model.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { rebuildSemanticModel } from './lib/onnxSurgery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string} rel */
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const args = process.argv.slice(2);
const check = args.includes('--check');
const printPins = args.includes('--print-pins');
/** @param {string} name */
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null);
const onlyModel = argValue('--model');
const onlyVariant = argValue('--variant');

/** @param {string} tag @param {string} message */
const log = (tag, message) => process.stdout.write(`[fetch:models] ${tag}: ${message}\n`);

/** @param {string | Uint8Array} fileOrBytes */
function sha256(fileOrBytes) {
  const bytes = typeof fileOrBytes === 'string' ? fs.readFileSync(fileOrBytes) : fileOrBytes;
  return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} target @param {number} bytes @param {string} digest */
function isCurrent(target, bytes, digest) {
  if (!fs.existsSync(target)) return false;
  if (fs.statSync(target).size !== bytes) return false;
  return sha256(target) === digest;
}

/**
 * Stream `url` to `target`, verifying size and SHA-256 before the rename.
 * @param {string} tag @param {string} url @param {string} target @param {number} bytes @param {string} digest
 */
async function download(tag, url, target, bytes, digest) {
  const tmp = `${target}.download`;
  log(tag, url);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${tag}: HTTP ${response.status} for ${url}`);
  const hash = createHash('sha256');
  let received = 0;
  const source = Readable.fromWeb(
    /** @type {import('node:stream/web').ReadableStream<Uint8Array>} */ (/** @type {unknown} */ (response.body)),
  );
  source.on('data', (/** @type {Buffer} */ chunk) => {
    hash.update(chunk);
    received += chunk.byteLength;
  });
  await pipeline(source, fs.createWriteStream(tmp));
  const got = hash.digest('hex');
  if (received !== bytes || got !== digest) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`${tag}: integrity check failed (${received} B, sha256 ${got}; expected ${bytes} B, ${digest})`);
  }
  fs.renameSync(tmp, target);
  log(tag, `${(received / 1e6).toFixed(1)} MB verified → ${path.relative(root, target)}`);
}

/**
 * The members of a zip archive (stored or deflated; no zip64, no encryption) —
 * enough for the pinned model archive, with no dependency.
 * @param {Uint8Array} zip @returns {Map<string, Uint8Array>}
 */
function unzip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  /** @type {Map<string, Uint8Array>} */
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = zip.subarray(dataStart, dataStart + compressed);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`zip: ${name} uses unsupported method ${method}`);
    if (data.length !== size) throw new Error(`zip: ${name} inflated to ${data.length} B, expected ${size}`);
    out.set(name, data);
  }
  return out;
}

// ------------------------------------------------------------------ depth (#320)

function depthModel() {
  const manifest = readJson('src/renderer/depth/depthModel.manifest.json');
  const outDir = path.join(root, 'public', 'models', 'depth');
  const variants = Object.entries(manifest.variants).filter(([name]) => !onlyVariant || name === onlyVariant);
  if (variants.length === 0) {
    throw new Error(`unknown depth variant "${onlyVariant}" (have: ${Object.keys(manifest.variants).join(', ')})`);
  }
  return {
    name: 'depth',
    missing() {
      return variants
        .filter(([, v]) => !isCurrent(path.join(outDir, v.file), v.bytes, v.sha256))
        .map(([name]) => `depth/${name}`);
    },
    async fetch() {
      fs.mkdirSync(outDir, { recursive: true });
      for (const [name, v] of variants) {
        const target = path.join(outDir, v.file);
        if (isCurrent(target, v.bytes, v.sha256)) {
          log(`depth/${name}`, 'up to date');
          continue;
        }
        await download(`depth/${name}`, `${manifest.source}/resolve/${manifest.revision}/${v.remote}`, target, v.bytes, v.sha256);
      }
      fs.writeFileSync(path.join(outDir, 'NOTICE.txt'), [
        `${manifest.model} — ONNX export`,
        `Source:   ${manifest.source} (revision ${manifest.revision})`,
        `License:  ${manifest.license} — https://www.apache.org/licenses/LICENSE-2.0`,
        'Upstream: https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf (Apache-2.0)',
        '',
        'Served as-is (quantised by the source repository) for the Street View scene-depth pass.',
        'Only the Small model is Apache-2.0; Depth Anything V2 Base/Large are CC-BY-NC-4.0 and are not used.',
        'See docs/SCENE_DEPTH.md in the application repository.',
        '',
      ].join('\n'));
    },
  };
}

// --------------------------------------------------------------- semantic (#352)

/**
 * The class head's grouping, from the manifest's names (the table the app reads too).
 * @param {{ classes: Array<{ name: string, from: string[] }>, sourceClasses: string[] }} manifest
 */
function classGroups(manifest) {
  return manifest.classes.map((c) => c.from.map((label) => {
    const index = manifest.sourceClasses.indexOf(label);
    if (index < 0) throw new Error(`semantic: class "${c.name}" maps unknown source label "${label}"`);
    return index;
  }));
}

function semanticModel() {
  const manifest = readJson('src/renderer/semantic/semanticModel.manifest.json');
  const outDir = path.join(root, 'public', 'models', 'semantic');
  const target = path.join(outDir, manifest.file);
  return {
    name: 'semantic',
    missing() {
      return isCurrent(target, manifest.bytes, manifest.sha256) ? [] : ['semantic'];
    },
    async fetch() {
      fs.mkdirSync(outDir, { recursive: true });
      if (!printPins && isCurrent(target, manifest.bytes, manifest.sha256)) {
        log('semantic', 'up to date');
        return;
      }
      const archive = path.join(outDir, 'source.zip');
      const src = manifest.source;
      if (!isCurrent(archive, src.bytes, src.sha256)) {
        await download('semantic/source', src.url, archive, src.bytes, src.sha256);
      }
      const members = unzip(new Uint8Array(fs.readFileSync(archive)));
      const graph = members.get(src.graph);
      const weights = members.get(src.weights);
      if (!graph || !weights) throw new Error(`semantic: archive lacks ${src.graph} / ${src.weights}`);
      const labels = new TextDecoder().decode(members.get(src.labels) ?? new Uint8Array()).trim().split('\n');
      if (labels.join('|') !== manifest.sourceClasses.join('|')) {
        throw new Error(`semantic: archive labels differ from the manifest's sourceClasses (${labels.join(', ')})`);
      }
      const { bytes, stats } = rebuildSemanticModel(graph, weights, {
        classGroups: classGroups(manifest),
        inputScale: manifest.inputScale ?? 1,
      });
      const digest = sha256(bytes);
      log('semantic', `rebuilt: ${stats.resizes} resizes made dynamic, ${stats.castWeights} weights stored as fp16, `
        + `${(bytes.length / 1e6).toFixed(1)} MB`);
      if (printPins) log('semantic', `pins: "bytes": ${bytes.length}, "sha256": "${digest}"`);
      if (bytes.length !== manifest.bytes || digest !== manifest.sha256) {
        throw new Error(`semantic: rebuilt model does not match the manifest (${bytes.length} B, sha256 ${digest}; `
          + `expected ${manifest.bytes} B, ${manifest.sha256}) — a changed rebuild needs new pins and a cacheVersion bump`);
      }
      const tmp = `${target}.download`;
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, target);
      fs.rmSync(archive, { force: true });
      log('semantic', `verified → ${path.relative(root, target)}`);
      fs.writeFileSync(path.join(outDir, 'NOTICE.txt'), [
        `${manifest.model} — ONNX, rebuilt for the browser`,
        `Source:   ${src.url}`,
        `          (sha256 ${src.sha256})`,
        `Exported: ${manifest.exportedBy}`,
        `Upstream: ${manifest.upstream}`,
        `License:  ${manifest.license} — ${manifest.licenseUrl}`,
        '',
        'Rebuilt by scripts/fetch-models.mjs (scripts/lib/onnxSurgery.mjs): the input normalisation',
        'prologue removed, height/width made symbolic, weights stored as fp16, and a 7-class head',
        '(softmax, class grouping, bilinear upsample) appended. The weights are unchanged otherwise.',
        'See docs/SCENE_SEMANTIC.md in the application repository.',
        '',
      ].join('\n'));
    },
  };
}

async function main() {
  const all = { depth: depthModel, semantic: semanticModel };
  if (onlyModel && !(onlyModel in all)) throw new Error(`unknown model "${onlyModel}" (have: ${Object.keys(all).join(', ')})`);
  const models = Object.entries(all)
    .filter(([name]) => !onlyModel || name === onlyModel)
    .map(([, make]) => make());

  if (check) {
    const missing = models.flatMap((m) => m.missing());
    if (missing.length) {
      console.error(`[fetch:models] missing or stale: ${missing.join(', ')} — run npm run fetch:models`);
      process.exit(1);
    }
    console.log(`[fetch:models] OK: ${models.map((m) => m.name).join(', ')}`);
    return;
  }
  for (const model of models) await model.fetch();
}

main().catch((error) => {
  console.error(`[fetch:models] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
