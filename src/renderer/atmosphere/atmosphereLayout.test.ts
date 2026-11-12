/**
 * `AtmosphereParams` and the binding numbers in atmosphere.wgsl against
 * atmosphereLayout.ts, and the C++ block's length against the medium slots —
 * the three must move together.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { requireWasm } from '../../wasm';
import {
    ATMOSPHERE_LUT_SIZES,
    ATMOSPHERE_MEDIUM_FLOAT_COUNT,
    ATMOSPHERE_UNIFORM_FLOAT_COUNT,
    ATMOSPHERE_WORKGROUP,
    AtmosphereBinding,
    AtmosphereUniformIndex,
} from './atmosphereLayout';

const WGSL = readFileSync(join(__dirname, '..', '..', '..', 'public', 'shaders', 'atmosphere.wgsl'), 'utf8');

describe('atmosphere layout', () => {
    it('AtmosphereParams is 8 vec4 fields (32 floats)', () => {
        const struct = /struct AtmosphereParams \{([\s\S]*?)\n\}/.exec(WGSL)?.[1] ?? '';
        const fields = [...struct.matchAll(/^\s*(\w+): vec4<f32>,/gm)].map((m) => m[1]);
        expect(fields).toEqual([
            'radii', 'rayleighG', 'mieScatOzoneCenter', 'mieExtOzoneWidth',
            'ozoneVisibility', 'albedoTurbidity', 'sun', 'observer',
        ]);
        expect(fields.length * 4).toBe(ATMOSPHERE_UNIFORM_FLOAT_COUNT);
    });

    it('reads each slot through the field the index names', () => {
        const at = (field: string, lane: 'x' | 'y' | 'z' | 'w', index: number) => {
            expect(WGSL, `${field}.${lane}`).toContain(`atmo.${field}.${lane}`);
            expect(index).toBe(['radii', 'rayleighG', 'mieScatOzoneCenter', 'mieExtOzoneWidth', 'ozoneVisibility',
                'albedoTurbidity', 'sun', 'observer'].indexOf(field) * 4 + 'xyzw'.indexOf(lane));
        };
        at('radii', 'x', AtmosphereUniformIndex.bottomRadiusKm);
        at('radii', 'y', AtmosphereUniformIndex.topRadiusKm);
        at('radii', 'z', AtmosphereUniformIndex.rayleighScaleHeightKm);
        at('radii', 'w', AtmosphereUniformIndex.mieScaleHeightKm);
        at('rayleighG', 'w', AtmosphereUniformIndex.mieG);
        at('mieScatOzoneCenter', 'w', AtmosphereUniformIndex.ozoneCenterKm);
        at('mieExtOzoneWidth', 'w', AtmosphereUniformIndex.ozoneHalfWidthKm);
        at('sun', 'x', AtmosphereUniformIndex.sinSunElevation);
        at('sun', 'y', AtmosphereUniformIndex.cosSunElevation);
        at('sun', 'z', AtmosphereUniformIndex.sunIlluminance);
        at('observer', 'x', AtmosphereUniformIndex.observerAltitudeKm);
        at('observer', 'y', AtmosphereUniformIndex.aerialMaxKm);
    });

    it('the C++ params block fills exactly the medium slots', () => {
        const block = requireWasm().atmoParams(null, 0.3);
        expect(block.length).toBe(ATMOSPHERE_MEDIUM_FLOAT_COUNT);
        expect(AtmosphereUniformIndex.sinSunElevation).toBe(ATMOSPHERE_MEDIUM_FLOAT_COUNT);
        expect(block[AtmosphereUniformIndex.bottomRadiusKm]).toBe(6360);
        expect(block[AtmosphereUniformIndex.topRadiusKm]).toBe(6460);
        expect(block[AtmosphereUniformIndex.visibilityKm]).toBe(23);
    });

    it('binding numbers match the WGSL declarations', () => {
        const declared = new Map(
            [...WGSL.matchAll(/@group\(0\) @binding\((\d+)\) var(?:<\w+>)? (\w+):/g)].map((m) => [m[2], Number(m[1])]),
        );
        expect(Object.fromEntries(declared)).toEqual({
            atmo: AtmosphereBinding.params,
            lutSampler: AtmosphereBinding.sampler,
            transmittanceTex: AtmosphereBinding.transmittance,
            multiscatterTex: AtmosphereBinding.multiscatter,
            transmittanceOut: AtmosphereBinding.transmittanceOut,
            multiscatterOut: AtmosphereBinding.multiscatterOut,
            skyviewOut: AtmosphereBinding.skyviewOut,
            aerialOut: AtmosphereBinding.aerialOut,
        });
    });

    it('every entry point uses the documented workgroup size, and the header lists the LUT sizes', () => {
        const entries = [...WGSL.matchAll(/@compute @workgroup_size\((\d+), (\d+), 1\)\nfn (\w+)/g)];
        expect(entries.map((m) => m[3])).toEqual(['transmittance_lut', 'multiscatter_lut', 'skyview_lut', 'aerial_lut']);
        for (const m of entries) expect([Number(m[1]), Number(m[2])]).toEqual([ATMOSPHERE_WORKGROUP, ATMOSPHERE_WORKGROUP]);
        expect(WGSL).toContain(`${ATMOSPHERE_LUT_SIZES.transmittance.join('x')}  rgba16float`);
        expect(WGSL).toContain(`${ATMOSPHERE_LUT_SIZES.multiscatter.join('x')}  rgba16float`);
        expect(WGSL).toContain(`${ATMOSPHERE_LUT_SIZES.skyview.join('x')} rgba16float`);
        expect(WGSL).toContain(`${ATMOSPHERE_LUT_SIZES.aerial.join('x')}  rgba16float`);
    });

    it('the transmittance entry point integrates with the C++ step count', () => {
        const cpp = readFileSync(join(__dirname, '..', '..', '..', 'cpp', 'src', 'atmosphere_module.cpp'), 'utf8');
        const steps = /constexpr int kTransmittanceSteps = (\d+);/.exec(cpp)?.[1];
        expect(steps).toBeDefined();
        expect(WGSL).toContain(`const TRANSMITTANCE_STEPS: i32 = ${steps};`);
    });
});
