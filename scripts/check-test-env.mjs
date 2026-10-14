#!/usr/bin/env node
/**
 * Vitest's default environment is `node` (vite.config.ts); a spec that touches the DOM must opt in with
 * `// @vitest-environment jsdom` in its leading comments, otherwise it fails at run time with
 * `document is not defined` — which is how #304 turned `main` red after #315 flipped the default.
 *
 * Walks every spec's AST (not text, so strings/comments don't count) and fails when it reads a DOM-only
 * global as a bare identifier without the pragma. `typeof document` probes and `globalThis.document`/
 * `vi.stubGlobal('document', …)` are fine: they are how node-env specs *provide* or detect a DOM.
 *
 *   node scripts/check-test-env.mjs [files…]   (default: every src/**\/*.{test,spec}.{ts,tsx})
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Globals that only exist under jsdom/happy-dom. `window`/`navigator` are included: node has neither. */
export const DOM_GLOBALS = new Set([
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLVideoElement',
  'HTMLImageElement',
  'HTMLInputElement',
  'CanvasRenderingContext2D',
  'MouseEvent',
  'KeyboardEvent',
  'PointerEvent',
  'WheelEvent',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'matchMedia',
]);

const PRAGMA = /^\s*\/\/\s*@vitest-environment\s+(jsdom|happy-dom)\b/m;

/** True when `id` is a declaration/property name or a `typeof` probe rather than a read of the global. */
function isIncidental(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true; // foo.document
  if (ts.isPropertyAssignment(p) && p.name === id) return true; // { window: … }
  if (ts.isShorthandPropertyAssignment(p)) return false; // { window } reads the global
  if (ts.isTypeOfExpression(p)) return true; // typeof document
  if (ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isExpressionWithTypeArguments(p)) return true;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p)) && p.name === id) {
    return true; // local shadowing
  }
  if (ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) {
    return p.name === id;
  }
  return false;
}

/** @returns {{ line: number, name: string }[]} DOM-global reads in `source`. */
export function domReads(source, fileName = 'spec.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  const shadowed = new Set();
  // A file-level `const window = …` / `function document()` means the name is not the global.
  sf.forEachChild((n) => {
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) shadowed.add(d.name.text);
    if (ts.isFunctionDeclaration(n) && n.name) shadowed.add(n.name.text);
  });
  (function walk(n) {
    if (ts.isIdentifier(n) && DOM_GLOBALS.has(n.text) && !shadowed.has(n.text) && !isIncidental(n)) {
      hits.push({ line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, name: n.text });
    }
    ts.forEachChild(n, walk);
  })(sf);
  return hits;
}

export function hasPragma(source) {
  // Vitest only honours the pragma inside the leading comment block, before any code.
  const lead = /^(?:\s*(?:\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/))*/.exec(source)[0];
  return PRAGMA.test(lead);
}

function* specs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* specs(p);
    else if (/\.(test|spec)\.tsx?$/.test(name)) yield p;
  }
}

function main() {
  const root = join(fileURLToPath(import.meta.url), '..', '..');
  const files = process.argv.length > 2 ? process.argv.slice(2) : [...specs(join(root, 'src'))];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (hasPragma(src)) continue;
    const reads = domReads(src, f);
    if (reads.length) bad.push({ f: relative(root, f), reads });
  }
  if (!bad.length) {
    console.log(`✅ test environments: ${files.length} specs, every DOM user carries a jsdom pragma`);
    return;
  }
  console.error('❌ specs read DOM globals but run in the default `node` environment:\n');
  for (const { f, reads } of bad) {
    const first = reads[0];
    console.error(`  ${f}:${first.line}  ${[...new Set(reads.map((r) => r.name))].join(', ')}`);
  }
  console.error('\nAdd `// @vitest-environment jsdom` as the first line of each (see vite.config.ts → test.environment).');
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
