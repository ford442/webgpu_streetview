#!/usr/bin/env node
/**
 * Fetch the scene-depth model (#320) into public/models/depth/ — at deploy time,
 * not into git (the directory is gitignored).
 *
 *   node scripts/fetch-depth-model.mjs            fetch every variant that is missing or stale
 *   node scripts/fetch-depth-model.mjs --variant q4f16
 *   node scripts/fetch-depth-model.mjs --check    exit 1 unless every variant is present and verified
 *
 * Pins (Hugging Face revision, file sizes, SHA-256) come from
 * src/renderer/depth/depthModel.manifest.json, the same manifest the app reads.
 * A download is written to a temp file, verified, then renamed into place, so a
 * failed or tampered download never leaves a file the app would serve. A
 * NOTICE.txt with the Apache-2.0 attribution is written beside the models.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'src/renderer/depth/depthModel.manifest.json'), 'utf8'),
);
const outDir = path.join(root, 'public', 'models', 'depth');

const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : null;

/** @param {string} file */
function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** @param {{ file: string, bytes: number, sha256: string }} v */
function isCurrent(v) {
  const target = path.join(outDir, v.file);
  if (!fs.existsSync(target)) return false;
  if (fs.statSync(target).size !== v.bytes) return false;
  return sha256(target) === v.sha256;
}

/** @param {string} name @param {{ file: string, remote: string, bytes: number, sha256: string }} v */
async function download(name, v) {
  const url = `${manifest.source}/resolve/${manifest.revision}/${v.remote}`;
  const target = path.join(outDir, v.file);
  const tmp = `${target}.download`;
  process.stdout.write(`[fetch:depth-model] ${name}: ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status} for ${url}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const source = Readable.fromWeb(
    /** @type {import('node:stream/web').ReadableStream<Uint8Array>} */ (/** @type {unknown} */ (response.body)),
  );
  source.on('data', (/** @type {Buffer} */ chunk) => {
    hash.update(chunk);
    bytes += chunk.byteLength;
  });
  await pipeline(source, fs.createWriteStream(tmp));
  const digest = hash.digest('hex');
  if (bytes !== v.bytes || digest !== v.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`${name}: integrity check failed (${bytes} B, sha256 ${digest}; expected ${v.bytes} B, ${v.sha256})`);
  }
  fs.renameSync(tmp, target);
  process.stdout.write(`[fetch:depth-model] ${name}: ${(bytes / 1e6).toFixed(1)} MB verified → ${path.relative(root, target)}\n`);
}

function writeNotice() {
  const lines = [
    `${manifest.model} — ONNX export`,
    `Source:   ${manifest.source} (revision ${manifest.revision})`,
    `License:  ${manifest.license} — https://www.apache.org/licenses/LICENSE-2.0`,
    'Upstream: https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf (Apache-2.0)',
    '',
    'Served as-is (quantised by the source repository) for the Street View scene-depth pass.',
    'Only the Small model is Apache-2.0; Depth Anything V2 Base/Large are CC-BY-NC-4.0 and are not used.',
    'See docs/SCENE_DEPTH.md in the application repository.',
    '',
  ];
  fs.writeFileSync(path.join(outDir, 'NOTICE.txt'), lines.join('\n'));
}

async function main() {
  const variants = Object.entries(manifest.variants).filter(([name]) => !only || name === only);
  if (variants.length === 0) throw new Error(`unknown variant "${only}" (have: ${Object.keys(manifest.variants).join(', ')})`);

  if (check) {
    const missing = variants.filter(([, v]) => !isCurrent(v)).map(([name]) => name);
    if (missing.length) {
      console.error(`[fetch:depth-model] missing or stale: ${missing.join(', ')} — run npm run fetch:depth-model`);
      process.exit(1);
    }
    console.log(`[fetch:depth-model] OK: ${variants.map(([n]) => n).join(', ')}`);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, v] of variants) {
    if (isCurrent(v)) {
      console.log(`[fetch:depth-model] ${name}: up to date`);
      continue;
    }
    await download(name, v);
  }
  writeNotice();
}

main().catch((error) => {
  console.error(`[fetch:depth-model] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
