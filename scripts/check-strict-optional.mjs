#!/usr/bin/env node
/**
 * The `exactOptionalPropertyTypes` ratchet (#340). `tsconfig.strict-optional.json`
 * compiles the folders in its `include` list with the flag on; tsc also checks
 * every file those folders import, so this fails only on diagnostics *inside*
 * the ratcheted folders. Add a folder to `include` once it is clean.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.strict-optional.json'), 'utf8'));
const folders = config.include.filter((p) => !p.includes('*')).map((p) => `${p.replace(/\/$/, '')}/`);

const tsc = spawnSync('npx', ['--no-install', 'tsc', '-p', 'tsconfig.strict-optional.json', '--pretty', 'false'], {
  cwd: root,
  encoding: 'utf8',
});
const lines = `${tsc.stdout}${tsc.stderr}`.split('\n');
const errors = lines.filter((line) => /error TS\d+/.test(line) && folders.some((f) => line.startsWith(f)));
if (errors.length) {
  console.error(`exactOptionalPropertyTypes: ${errors.length} error(s) in ${folders.join(', ')}`);
  for (const line of errors) console.error(`  ${line}`);
  process.exit(1);
}
const outside = lines.filter((line) => /error TS\d+/.test(line)).length;
console.log(`exactOptionalPropertyTypes clean in ${folders.join(', ')} (${outside} outside the ratchet, not gated)`);
