/**
 * Drift tripwire for the portal's mirror of `weather-post`.
 *
 * A droplet lens shows the road the way the road looks only because
 * `createRoadDisplay` (cabinPortalMaterial.ts) and `portalGrade.ts` repeat a slice
 * of `fs_main`. The authoritative check is GPU-side (`e2e/windshield-portal.spec.ts`
 * compares the real shader's pixels with the mirror's, to within a code value) —
 * but that needs a WebGPU browser. This is the jsdom-side complement: it reads the
 * shipped WGSL and fails, by name, when a constant or the stage ORDER the mirror
 * assumes stops being true, so the mirror gets updated in the same change.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ACES_TONEMAP_SDR_BODY } from '../../renderer/shaderFeatureVariants';
import {
    PORTAL_ACES,
    PORTAL_NIGHT,
    PORTAL_RAIN_DARKEN,
    PORTAL_VIGNETTE,
} from './cabinPortalMaterial';
import { computeTempMult } from './portalGrade';

const shaderDir = join(__dirname, '..', '..', '..', 'public', 'shaders');
const WEATHER = readFileSync(join(shaderDir, 'weather-post.wgsl'), 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const WEATHER_N = norm(WEATHER);

/** The body of `fn name(...) ... { ... }` — brace-matched. */
function fnBody(source: string, name: string): string {
    const start = source.indexOf(`fn ${name}(`);
    if (start < 0) throw new Error(`fn ${name} not found in weather-post.wgsl`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
    }
    throw new Error(`unbalanced braces in fn ${name}`);
}

/** Every numeric literal in `text`, as numbers, in order — WGSL type names (`vec3<f32>`) stripped first. */
const numbers = (text: string): number[] =>
    (text.replace(/vec\d<f32>|\b[fiu]32\b/g, '').match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

const FS_MAIN = fnBody(WEATHER, 'fs_main');

/** `portalGrade.ts` as written — not `Function.toString()`, because esbuild prints 1000 as `1e3`. */
const PORTAL_GRADE_TS = readFileSync(join(__dirname, 'portalGrade.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
function tsFnBody(source: string, name: string): string {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} not found in portalGrade.ts`);
    const open = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
    }
    throw new Error(`unbalanced braces in ${name}`);
}

describe('the stages the mirror assumes, in the order fs_main runs them', () => {
    it('grade → night → vignette → rain darkening → ACES', () => {
        const at = (needle: string) => {
            const i = FS_MAIN.indexOf(needle);
            if (i < 0) throw new Error(`"${needle}" not found in fs_main`);
            return i;
        };
        const order = [
            'applyVibrance(col, p.vibrance)',
            'applySaturation(col, p.saturation)',
            'applyContrast(col, p.contrast)',
            'applyTemperatureTint(col, p.temperature, p.tint)',
            'applyExposure(col, p.exposure)',
            'applyNight(col, p.nightIntensity',
            'applyVignette(col, uv)',
            'col * (1.0 - p.rainIntensity',
            'aces_tonemap(col)',
        ].map(at);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('returns the raw intermediate, ungraded, when shader effects are off', () => {
        // The portal's `graded` flag mirrors this bypass.
        expect(norm(FS_MAIN)).toContain(
            'if (p.shaderEffectsEnabled < 0.5) { return vec4<f32>(textureSample(sceneTex, linearSampler, uv).rgb, 1.0); }',
        );
    });
});

describe('ACES', () => {
    it('mirrors the SDR aces_tonemap the road ends on', () => {
        const coefficient = (name: string) =>
            Number(new RegExp(`let ${name} = ([0-9.]+);`).exec(ACES_TONEMAP_SDR_BODY)![1]);
        expect(
            (['a', 'b', 'c', 'd', 'e'] as const).map(coefficient),
        ).toEqual([PORTAL_ACES.a, PORTAL_ACES.b, PORTAL_ACES.c, PORTAL_ACES.d, PORTAL_ACES.e]);
    });

    it('is the shader that actually ships', () => {
        expect(WEATHER_N).toContain(norm(ACES_TONEMAP_SDR_BODY.split('\n').slice(1, -1).join('\n')));
    });
});

describe('colour grade', () => {
    it('kelvinToRGB: the CPU port carries every coefficient the shader does', () => {
        const wgsl = numbers(fnBody(WEATHER, 'kelvinToRGB'));
        // The TS port's source, so a mistyped digit or a dropped branch shows up here.
        const ts = numbers(tsFnBody(PORTAL_GRADE_TS, 'kelvinToRGB'));
        const distinct = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y);
        // Same set of distinct constants (the WGSL writes 255.0 where TS writes 255, etc.).
        expect(distinct(ts)).toEqual(distinct(wgsl));
    });

    it('applyTemperatureTint: 6500 K neutral, 5000 K per unit, and the 0.1 / 0.05 tint gains', () => {
        const body = norm(fnBody(WEATHER, 'applyTemperatureTint'));
        expect(body).toContain('let kelvin = 6500.0 + temperature * 5000.0;');
        expect(body).toContain('let neutralRGB = kelvinToRGB(6500.0);');
        expect(body).toContain('tempMult.g = tempMult.g * (1.0 + tint * 0.1);');
        expect(body).toContain('tempMult.r = tempMult.r * (1.0 + tint * 0.05);');
        expect(body).toContain('tempMult.b = tempMult.b * (1.0 + tint * 0.05);');
        expect(body).toContain('return col * tempMult;');
    });

    it('temperature 0 / tint 0 is exactly neutral', () => {
        const [r, g, b] = computeTempMult(0, 0);
        expect(r).toBeCloseTo(1, 12);
        expect(g).toBeCloseTo(1, 12);
        expect(b).toBeCloseTo(1, 12);
    });

    it('positive temperature raises the kelvin the shader multiplies by, so it shifts toward blue', () => {
        // `kelvin = 6500 + temperature * 5000` — the knob is the colour temperature of the
        // light being compensated, not "warmth". Pinning the sign the shader really has.
        const [r, , b] = computeTempMult(0.5, 0);
        expect(b).toBeGreaterThan(r);
        const [r2, , b2] = computeTempMult(-0.5, 0);
        expect(r2).toBeGreaterThan(b2);
    });

    it('vibrance / saturation / contrast / exposure keep the forms the graph writes', () => {
        expect(norm(fnBody(WEATHER, 'applyVibrance'))).toContain(
            'return col + (col - vec3<f32>(luma)) * vibrance * (1.0 - sat);',
        );
        expect(norm(fnBody(WEATHER, 'applySaturation'))).toContain(
            'return mix(vec3<f32>(luma), col, 1.0 + saturation);',
        );
        expect(norm(fnBody(WEATHER, 'applyContrast'))).toContain(
            'return (col - vec3<f32>(0.5)) * (1.0 + contrast) + vec3<f32>(0.5);',
        );
        expect(norm(fnBody(WEATHER, 'applyExposure'))).toContain('return col * pow(2.0, exposure);');
        expect(norm(fnBody(WEATHER, 'applyVibrance'))).toContain('let maxC = max(max(col.r, col.g), col.b);');
        expect(norm(fnBody(WEATHER, 'applyVibrance'))).toContain('let sat = maxC - luma;');
    });
});

describe('night', () => {
    const body = norm(fnBody(WEATHER, 'applyNight'));
    const N = PORTAL_NIGHT;

    it.each([
        ['darkening curve', `c = c * mix(1.0, ${N.floorDaylight.toFixed(2)}, darkeningCurve);`],
        ['desaturation', `c = mix(c, vec3<f32>(gray), night * ${N.desaturate});`],
        ['moon tint', `let moonTint = vec3<f32>(${N.moonTint[0].toFixed(2)}, ${N.moonTint[1].toFixed(2)}, ${N.moonTint[2].toFixed(2)});`],
        ['moon tint gain', `c = c + moonTint * night * ${N.moonTintGain.toFixed(2)};`],
        ['sky edge', `let skyDarken = smoothstep(${N.skyEdges[0]}, ${N.skyEdges[1].toFixed(2)}, uv.y);`],
        ['sky darkening', `c = c * mix(1.0, ${N.skyDarken}, skyDarken * night);`],
        ['light mask', `let lightMask = smoothstep(${N.lightMaskEdges[0]}, ${N.lightMaskEdges[1]}, lum);`],
        ['light preserve', `c = c + col * lightMask * night * ${N.lightPreserve};`],
        ['vignette aspect', `let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(${N.vignetteAspect[0]}, ${N.vignetteAspect[1].toFixed(1)}));`],
        ['vignette', `let nightVignette = 1.0 - smoothstep(${N.vignetteEdges[0]}, ${N.vignetteEdges[1]}, centerDist) * night * ${N.vignette};`],
        ['floor', `return max(c, vec3<f32>(${N.floor}));`],
    ])('%s', (_name, expected) => {
        expect(body).toContain(expected);
    });

    it('the darkening curve is a smoothstep of night', () => {
        expect(body).toContain('let darkeningCurve = night * night * (3.0 - 2.0 * night);');
    });
});

describe('vignette and rain darkening', () => {
    it('applyVignette', () => {
        const body = norm(fnBody(WEATHER, 'applyVignette'));
        const V = PORTAL_VIGNETTE;
        expect(body).toContain(
            `let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(${V.aspect[0]}, ${V.aspect[1].toFixed(1)}));`,
        );
        expect(body).toContain(
            `let vignette = 1.0 - smoothstep(${V.edges[0]}, ${V.edges[1]}, centerDist) * ${V.strength};`,
        );
    });

    it('scene darkening under rain', () => {
        expect(norm(FS_MAIN)).toContain(
            `col = col * (1.0 - p.rainIntensity * mix(${PORTAL_RAIN_DARKEN.day}, ${PORTAL_RAIN_DARKEN.night.toFixed(2)}, p.nightIntensity));`,
        );
    });
});
