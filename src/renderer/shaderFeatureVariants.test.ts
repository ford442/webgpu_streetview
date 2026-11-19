import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import shaderManifest from '../shaders/shaders.manifest.json';
import {
    computeWeatherShaderFile,
    deviceHasFeature,
    HDR_INTERMEDIATE_FORMAT,
    HDR_INTERMEDIATE_FORMAT_PACKED,
    linkedShaderFile,
    resolveHdrIntermediateFormat,
    resolveShaderFeatureUses,
    weatherPostShaderFile,
    type LinkedShaderEntry,
    type ShaderCondition,
} from './shaderFeatureVariants';

const SHADER_ROOT = join(__dirname, '..', '..', 'public', 'shaders');

describe('resolveHdrIntermediateFormat', () => {
    it('keeps rgba16float when the packed feature is absent or alpha is required', () => {
        expect(resolveHdrIntermediateFormat([])).toBe(HDR_INTERMEDIATE_FORMAT);
        expect(resolveHdrIntermediateFormat(['rg11b10ufloat-renderable'], true))
            .toBe(HDR_INTERMEDIATE_FORMAT);
    });

    it('selects rg11b10ufloat when the feature is enabled and alpha is unused', () => {
        expect(resolveHdrIntermediateFormat(['rg11b10ufloat-renderable']))
            .toBe(HDR_INTERMEDIATE_FORMAT_PACKED);
    });
});

describe('shader feature gating', () => {
    it('deviceHasFeature is false without a features.has surface (jsdom / fakes)', () => {
        expect(deviceHasFeature(undefined, 'subgroups')).toBe(false);
        expect(deviceHasFeature({} as GPUDevice, 'subgroups')).toBe(false);
        const device = { features: { has: (n: GPUFeatureName) => n === 'subgroups' } } as unknown as GPUDevice;
        expect(deviceHasFeature(device, 'subgroups')).toBe(true);
        expect(deviceHasFeature(device, 'shader-f16')).toBe(false);
    });

    it('shader-f16 is never marked as used in a production shader', () => {
        const uses = resolveShaderFeatureUses(
            ['shader-f16', 'subgroups', 'rg11b10ufloat-renderable', 'dual-source-blending'],
            HDR_INTERMEDIATE_FORMAT_PACKED,
        );
        expect(uses.shaderF16).toBe(false);
        expect(uses.subgroups).toBe(true);
        expect(uses.rg11b10Intermediate).toBe(true);
        expect(uses.dualSourcePrecip).toBe(true);
    });
});

describe('linked shader variants are chosen by name', () => {
    it('names the default variant after the entry alone', () => {
        expect(linkedShaderFile('streetview')).toBe('streetview.wgsl');
        expect(linkedShaderFile('weather-post')).toBe('weather-post.wgsl');
        expect(linkedShaderFile('gpu-chores-hist', { subgroups: false })).toBe('gpu-chores-hist.wgsl');
    });

    it('appends enabled conditions in manifest order, whatever order the caller lists them', () => {
        expect(linkedShaderFile('weather-post', { hdr_grade: true, dual_source: true }))
            .toBe('weather-post.dual_source.hdr_grade.wgsl');
        expect(linkedShaderFile('gpu-chores-hist', { subgroups: true })).toBe('gpu-chores-hist.subgroups.wgsl');
    });

    it('refuses a condition the entry has no variant for, instead of quietly fetching the default', () => {
        expect(() => linkedShaderFile('streetview', { hdr_grade: true })).toThrow(/no "hdr_grade" variant/);
        expect(() => linkedShaderFile('weather-post-compute', { subgroups: true })).toThrow(/no "subgroups" variant/);
        // Off is always fine.
        expect(linkedShaderFile('streetview', { hdr_grade: false })).toBe('streetview.wgsl');
    });

    it('selects the fragment weather variant from the applied tone mapping and dual-source blending', () => {
        expect(weatherPostShaderFile('standard', false)).toBe('weather-post.wgsl');
        expect(weatherPostShaderFile('extended', false)).toBe('weather-post.hdr_grade.wgsl');
        expect(weatherPostShaderFile('standard', true)).toBe('weather-post.dual_source.wgsl');
        expect(weatherPostShaderFile('extended', true)).toBe('weather-post.dual_source.hdr_grade.wgsl');
    });

    it('selects the compute weather variant from the applied tone mapping only', () => {
        expect(computeWeatherShaderFile('standard')).toBe('weather-post-compute.wgsl');
        expect(computeWeatherShaderFile('extended')).toBe('weather-post-compute.hdr_grade.wgsl');
    });

    it('every name it can produce is a linked file in public/shaders', () => {
        for (const [entry, spec] of Object.entries(shaderManifest.entries)) {
            const conditions = ('conditions' in spec ? spec.conditions : []) as ShaderCondition[];
            for (let mask = 0; mask < 1 << conditions.length; mask += 1) {
                const enabled = Object.fromEntries(conditions.map((c, i) => [c, ((mask >> i) & 1) === 1]));
                const file = linkedShaderFile(entry as LinkedShaderEntry, enabled);
                expect(existsSync(join(SHADER_ROOT, file)), file).toBe(true);
            }
        }
    });
});
