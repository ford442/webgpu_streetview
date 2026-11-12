import { describe, expect, it } from 'vitest';
import {
    adapterIdentity,
    buildDepthAdapterRequest,
    oppositePowerPreference,
    sameAdapter,
} from './depthAdapterPolicy';

const id = (vendor: string, architecture = '', device = '') => ({ vendor, architecture, device, description: '' });

describe('depth Worker adapter policy (#367)', () => {
    it('follows the road: ?gpu=low-power reaches the Worker as low-power', () => {
        expect(buildDepthAdapterRequest({ requestOptions: { powerPreference: 'low-power' } }))
            .toEqual({ powerPreference: 'low-power' });
    });

    it('keeps feature level and fallback, drops xrCompatible', () => {
        const request = buildDepthAdapterRequest({
            requestOptions: {
                powerPreference: 'high-performance',
                forceFallbackAdapter: true,
                xrCompatible: true,
                featureLevel: 'compatibility',
            } as GPURequestAdapterOptions,
        });
        expect(request).toEqual({ powerPreference: 'high-performance', forceFallbackAdapter: true, featureLevel: 'compatibility' });
    });

    it('before the road booted: the historical high-performance request', () => {
        expect(buildDepthAdapterRequest(null)).toEqual({ powerPreference: 'high-performance' });
    });

    it('flips the power preference for the one retry', () => {
        expect(oppositePowerPreference('low-power')).toBe('high-performance');
        expect(oppositePowerPreference('high-performance')).toBe('low-power');
    });

    it('compares vendor / architecture / device where both report them', () => {
        expect(sameAdapter(id('intel', 'xe', '1'), id('intel', 'xe', '1'))).toBe(true);
        expect(sameAdapter(id('intel', 'xe'), id('nvidia', 'ampere'))).toBe(false);
        // A withheld field on one side is not a mismatch.
        expect(sameAdapter(id('intel', 'xe', '1'), id('intel', '', ''))).toBe(true);
        // Nothing comparable: unknown, never a mismatch.
        expect(sameAdapter(id(''), id('intel'))).toBeNull();
        expect(sameAdapter(null, id('intel'))).toBeNull();
    });

    it('reads GPUAdapter.info as a plain identity', () => {
        const adapter = { info: { vendor: 'apple', architecture: 'metal-3', device: '', description: 'M2' } } as unknown as GPUAdapter;
        expect(adapterIdentity(adapter)).toEqual({ vendor: 'apple', architecture: 'metal-3', device: '', description: 'M2' });
        expect(adapterIdentity(null)).toEqual({ vendor: '', architecture: '', device: '', description: '' });
    });
});
