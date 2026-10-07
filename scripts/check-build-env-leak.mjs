#!/usr/bin/env node
/**
 * Fails when a build output contains the VALUE of an env var that is not on the
 * public allowlist (scripts/public-env-keys.json). Catches the class of bug where
 * a stray secret in .env / CI env ends up inlined into the shipped bundle
 * (e.g. via a blanket `define` loop or a wide Vite `envPrefix`).
 *
 *   node scripts/check-build-env-leak.mjs [buildDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.resolve(root, process.argv[2] ?? 'build');
const allow = new Set(JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-env-keys.json'), 'utf8')));
const MIN_LEN = 12; // shorter values ("true", "1", urls like "./") collide with ordinary code

if (!fs.existsSync(buildDir)) {
  console.error(`check-build-env-leak: ${buildDir} does not exist — build first.`);
  process.exit(1);
}

/** KEY=value pairs from every .env* file present (never .env.example) plus process.env. */
function collectEnv() {
  const out = new Map();
  for (const name of fs.readdirSync(root)) {
    if (!/^\.env(\..+)?$/.test(name) || name === '.env.example') continue;
    for (const line of fs.readFileSync(path.join(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      out.set(m[1], m[2].replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(REACT_APP_|VITE_)/.test(k) && v) out.set(k, v);
  }
  return out;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.(js|css|html|json|map)$/.test(e.name)) yield full;
  }
}

const secrets = [...collectEnv()].filter(([k, v]) => !allow.has(k) && v.length >= MIN_LEN);
const files = [...walk(buildDir)].map((f) => [f, fs.readFileSync(f, 'utf8')]);
const leaks = [];
for (const [key, value] of secrets) {
  for (const [file, text] of files) {
    if (text.includes(value)) leaks.push(`${key} → ${path.relative(root, file)}`);
  }
}

if (leaks.length) {
  console.error('❌ Non-allowlisted env values found in the build output:');
  for (const l of leaks) console.error(`   ${l}`);
  console.error('   Add the key to scripts/public-env-keys.json only if it is safe for every visitor to see.');
  process.exit(1);
}
console.log(`✅ No non-allowlisted env values in ${path.relative(root, buildDir) || '.'} (${secrets.length} checked).`);
