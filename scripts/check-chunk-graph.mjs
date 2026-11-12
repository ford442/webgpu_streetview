#!/usr/bin/env node
/**
 * Checks `build/chunk-graph.json` (written by `vite build`, see `chunkGraphPlugin` in
 * vite.config.ts) against the chunk contracts in `scripts/chunks.json`:
 *
 *   - every contract chunk was emitted and holds its entry module(s), and only that chunk does;
 *   - no module matching a contract's `forbidden` expression is in that chunk;
 *   - the main chunk holds no `node_modules` package it forbids and no lazy chunk's entry —
 *     the check that fails when `onnxruntime-web` or `cesium` lands in main;
 *   - each singleton module is in exactly one chunk (a duplicate gets its own module-level state,
 *     and the cross-chunk handoff silently stops working).
 *
 *   node scripts/check-chunk-graph.mjs [buildDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ chunks: Record<string, { name: string; isEntry: boolean; modules: string[] }>; modules: Record<string, string[]> }} graph
 * @param {{ main?: { forbidden?: string[] }; chunks?: Array<{ name: string; entry: string; forbidden?: string[] }>; singletons?: Array<{ module: string }> }} contracts
 * @returns {string[]} one message per violation; empty when the graph honours the contracts
 */
export function checkChunkGraph(graph, contracts) {
  const errors = [];
  const chunkFiles = Object.keys(graph.chunks);
  const main = chunkFiles.filter((f) => graph.chunks[f].isEntry);
  if (main.length !== 1) errors.push(`expected exactly one entry chunk, found ${main.length}`);
  const mainFile = main[0];
  const mainModules = mainFile ? graph.chunks[mainFile].modules : [];
  const allIds = Object.keys(graph.modules);

  for (const contract of contracts.chunks ?? []) {
    const files = chunkFiles.filter((f) => graph.chunks[f].name === contract.name);
    if (files.length === 0) {
      errors.push(`chunk "${contract.name}" was not emitted (renamed, merged into another chunk, or tree-shaken?) — update scripts/chunks.json`);
      continue;
    }
    const entries = allIds.filter((id) => id.startsWith(contract.entry));
    if (entries.length === 0) {
      errors.push(`chunk "${contract.name}": entry ${contract.entry} is in no chunk`);
    }
    for (const id of entries) {
      const owners = graph.modules[id].filter((f) => !files.includes(f));
      if (owners.length > 0) {
        errors.push(`${id} is the entry of lazy chunk "${contract.name}" but also lands in ${owners.map((f) => path.basename(f)).join(', ')}`);
      }
    }
    for (const pattern of contract.forbidden ?? []) {
      const re = new RegExp(pattern);
      for (const file of files) {
        for (const id of graph.chunks[file].modules) {
          if (re.test(id)) errors.push(`chunk "${contract.name}" contains forbidden module ${id} (/${pattern}/)`);
        }
      }
    }
  }

  const mainForbidden = [...(contracts.main?.forbidden ?? [])];
  for (const pattern of mainForbidden) {
    const re = new RegExp(pattern);
    for (const id of mainModules) {
      if (re.test(id)) errors.push(`the main chunk contains forbidden module ${id} (/${pattern}/) — keep it lazy / out of the bundle`);
    }
  }
  for (const contract of contracts.chunks ?? []) {
    for (const id of mainModules) {
      if (id.startsWith(contract.entry)) errors.push(`the main chunk contains ${id}, the entry of lazy chunk "${contract.name}"`);
    }
  }

  for (const { module: id } of contracts.singletons ?? []) {
    const owners = graph.modules[id] ?? [];
    if (owners.length === 0) errors.push(`singleton ${id} is in no chunk — renamed or tree-shaken?`);
    else if (owners.length > 1) {
      errors.push(`singleton ${id} was duplicated into ${owners.length} chunks: ${owners.map((f) => path.basename(f)).join(', ')} (each copy gets its own module state)`);
    }
  }
  return errors;
}

function main() {
  const buildDir = path.resolve(root, process.argv[2] ?? 'build');
  const graphPath = path.join(buildDir, 'chunk-graph.json');
  if (!fs.existsSync(graphPath)) {
    console.error(`❌ ${path.relative(root, graphPath)} is missing — \`vite build\` writes it (chunkGraphPlugin in vite.config.ts).`);
    process.exit(1);
  }
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const contracts = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'chunks.json'), 'utf8'));
  const errors = checkChunkGraph(graph, contracts);
  if (errors.length > 0) {
    for (const e of errors) console.error(`❌ ${e}`);
    console.error(`❌ chunk graph breaks ${errors.length} contract(s) in scripts/chunks.json`);
    process.exit(1);
  }
  const chunks = Object.keys(graph.chunks).length;
  console.log(`✅ chunk graph honours scripts/chunks.json (${chunks} chunks, ${(contracts.chunks ?? []).length} contracts, ${(contracts.singletons ?? []).length} singletons)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
