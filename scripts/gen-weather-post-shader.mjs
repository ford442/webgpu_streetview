#!/usr/bin/env node
/**
 * Regenerates public/shaders/weather-post.wgsl by concatenating its source
 * fragments under public/shaders/weather-post/. WGSL has no #include, and the
 * runtime (WeatherPostProcessor.ts) fetches weather-post.wgsl as a single
 * static asset, so that file stays the real build/test artifact — the
 * fragments below are the editable source of truth, split by responsibility
 * because the combined file had grown past ~1,100 lines.
 *
 * Usage:
 *   npm run gen:weather-shader
 *
 * src/renderer/weatherPostShaderSplit.test.ts fails if the generated file
 * drifts from these fragments, so this must be re-run (and the diff
 * committed) after editing any fragment.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const WEATHER_POST_FRAGMENTS = [
    'public/shaders/weather-post/01-foundation.wgsl',
    'public/shaders/weather-post/02-weather-fx.wgsl',
    'public/shaders/weather-post/03-night-and-composite.wgsl',
];

export const WEATHER_POST_OUTPUT = 'public/shaders/weather-post.wgsl';

export function buildWeatherPostSource() {
    return WEATHER_POST_FRAGMENTS.map((relPath) => readFileSync(join(repoRoot, relPath), 'utf8')).join('');
}

function main() {
    const source = buildWeatherPostSource();
    writeFileSync(join(repoRoot, WEATHER_POST_OUTPUT), source);
    console.log(`[gen:weather-shader] wrote ${WEATHER_POST_OUTPUT} from ${WEATHER_POST_FRAGMENTS.length} fragments`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
