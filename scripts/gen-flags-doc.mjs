#!/usr/bin/env node
/**
 * Generates docs/FLAGS.md from the FLAGS schema in src/config/flags.ts.
 *   node scripts/gen-flags-doc.mjs           write the file
 *   node scripts/gen-flags-doc.mjs --check   exit 1 when the file is stale
 *
 * flags.ts is TypeScript; Node 22+ strips types natively. On older Node we bundle it
 * with esbuild (a transitive dependency of vite) into a temp file first.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'FLAGS.md');

async function loadFlags() {
  const { build } = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-'));
  const file = path.join(tmp, 'flags.mjs');
  await build({
    entryPoints: [path.join(root, 'src/config/flags.ts')],
    outfile: file,
    format: 'esm',
    bundle: true,
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(file).href);
  fs.rmSync(tmp, { recursive: true, force: true });
  return mod.FLAGS;
}

function describeValues(def) {
  switch (def.kind) {
    case 'bool':
      return '`1\\|true\\|on\\|yes` / `0\\|false\\|off\\|no`';
    case 'tri':
      return '`on\\|off\\|auto` (bool spellings accepted)';
    case 'enum':
      return def.values.map((v) => `\`${v}\``).join(' \\| ');
    case 'number': {
      const range = def.min !== undefined || def.max !== undefined ? ` (${def.min ?? '−∞'}…${def.max ?? '∞'})` : '';
      return `number${range}`;
    }
    case 'tokens':
      return def.values ? `comma list: ${def.values.map((v) => `\`${v}\``).join(', ')}` : 'comma list';
  }
}

function render(FLAGS) {
  const rows = Object.entries(FLAGS).map(([name, def]) => {
    const dflt = def.default === undefined ? '—' : `\`${def.default}\``;
    return `| \`?${name}\` | ${def.kind} | ${describeValues(def)} | ${dflt} | ${def.doc.replace(/\|/g, '\\|')} |`;
  });
  return `# URL flags

> **Generated** from \`src/config/flags.ts\` by \`npm run gen:flags-doc\` — do not edit by hand.
> \`src/config/flags.test.ts\` fails when this file is stale.

Every flag is parsed by \`src/config/flags.ts\` (\`readFlag\`). The grammar is the same for all of them:

- **true** — bare presence (\`?flag\`, \`?flag=\`) or \`1 | true | on | yes\`
- **false** — \`0 | false | off | no\`
- **unset** — absent, or an unrecognised value (the flag's default applies)
- Values are case-insensitive.

Where a flag also has a persisted \`localStorage\` choice, precedence is URL → storage → preset/auto-detect.

| Flag | Type | Values | Default | Effect |
|---|---|---|---|---|
${rows.join('\n')}
`;
}

const FLAGS = await loadFlags();
const next = render(FLAGS);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== next) {
    console.error('docs/FLAGS.md is stale — run `npm run gen:flags-doc`.');
    process.exit(1);
  }
  console.log('docs/FLAGS.md is up to date.');
} else {
  fs.writeFileSync(out, next);
  console.log(`Wrote ${path.relative(root, out)} (${Object.keys(FLAGS).length} flags).`);
}
