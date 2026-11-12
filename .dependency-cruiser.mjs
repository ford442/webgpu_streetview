/**
 * Architecture rules. The layer table lives in scripts/architecture.json; this file only turns
 * it into rules, so the docs and the cruiser cannot disagree. The lazy-chunk rule (no static
 * reachability of a chunk entry from src/index.tsx) is not a per-edge rule, so it lives in
 * scripts/check-architecture.mjs, which also runs this file.
 *
 *   npm run check:architecture              fail on any violation
 *   npm run check:architecture -- --report  also write build/architecture-report.html
 *
 * Type-only imports count (`tsPreCompilationDeps`): a `import type` upward is still a dependency
 * edge, and is the way cycles between layers start.
 * Tests are cruised (so a module only a test imports is not an orphan) but exempt from the layer, chunk
 * and entry rules — they may reach across layers to build fixtures.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const readJson = (file) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'));
const architecture = readJson('./scripts/architecture.json');

const TESTS = ['\\.(test|spec)\\.tsx?$', '/__tests__/', '^src/setupTests\\.ts$'];
const alt = (folders) => `(${folders.join('|')})`;
const layers = architecture.layers;

const layerRules = layers.flatMap((layer, i) => {
  const above = layers.slice(i + 1).flatMap((l) => l.folders);
  if (above.length === 0) return [];
  return [
    {
      name: `layer-${layer.name}-imports-upward`,
      comment: `${layer.name} (${layer.folders.join(', ')}) must not import ${above.join(', ')}. Move the shared piece down, or invert the dependency.`,
      severity: 'error',
      from: { path: `^src/${alt(layer.folders)}/`, pathNot: TESTS },
      to: { path: `^src/${alt(above)}/` },
    },
  ];
});

const allFolders = layers.flatMap((l) => l.folders);

const entryRules = Object.entries(architecture.packages ?? {}).flatMap(([pkg, { entries }]) => {
  const layerIndex = layers.findIndex((l) => l.folders.includes(pkg));
  const above = layers.slice(layerIndex + 1).flatMap((l) => l.folders);
  if (above.length === 0) return [];
  return [
    {
      name: `only-through-entry-${pkg}`,
      comment: `src/${pkg}/ is a package: ${above.join(', ')} import it through ${entries.map((e) => `${pkg}/${e}`).join(' or ')} only. If something is missing from the public surface, add it there (a pure re-export) — do not reach in. \`import()\` of a lazy entry is exempt.`,
      severity: 'error',
      from: { path: `^src/${alt(above)}/`, pathNot: TESTS },
      to: {
        path: `^src/${pkg}/`,
        pathNot: entries.map((e) => `^src/${pkg}/${e.replace(/[.]/g, '\\.')}$`),
        dependencyTypesNot: ['dynamic-import', 'type-import'],
      },
    },
  ];
});

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A cycle between modules. Type-only cycles count: they become runtime cycles the day the type becomes a value.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    ...layerRules,
    ...entryRules,
    {
      name: 'no-import-of-root-entries',
      comment: 'src/index.tsx and src/App.tsx are the top of the graph; nothing in a layer folder imports them.',
      severity: 'error',
      from: { path: `^src/${alt(allFolders)}/`, pathNot: TESTS },
      to: { path: '^src/[^/]+\\.tsx?$', pathNot: '^src/[^/]+\\.d\\.ts$' },
    },
    {
      name: 'no-unlisted-folder',
      comment: 'Every top-level src/ folder belongs to a layer in scripts/architecture.json.',
      severity: 'error',
      from: { path: '^src/[^/]+/', pathNot: `^src/${alt(allFolders)}/` },
      to: {},
    },
    {
      name: 'no-orphans',
      comment: 'A module nothing imports and that imports nothing.',
      severity: 'error',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '^src/(index|setupTests)\\.tsx?$', ...TESTS] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['^src/vitest-env\\.d\\.ts$'] },
    includeOnly: '^src',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
    cache: { folder: 'node_modules/.cache/dependency-cruiser', strategy: 'content' },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
