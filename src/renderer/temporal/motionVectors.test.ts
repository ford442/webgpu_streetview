// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bindingBuffer,
    bindingTexture,
    createFakeGpu,
    installGpuGlobals,
    installShaderFetch,
    type FakeGpu,
    type RecordedBindGroup,
} from '../computeWeather/__tests__/fakeGpu';
import { getSceneDepthFallback } from '../depth/sceneDepthBinding';
import { MOTION_FORMAT, packMotionUniforms } from './motionMath';
import { MotionVectorPass } from './motionVectors';

let gpu: FakeGpu;

async function ready(): Promise<MotionVectorPass> {
    const pass = new MotionVectorPass(gpu.device);
    await pass.init();
    expect(pass.isReady()).toBe(true);
    return pass;
}

const live = () => gpu.textures.filter((t) => t.descriptor.label === 'motion-field' && !t.destroyed);
const uniformWrites = () => gpu.writeBufferCalls.filter((c) => c.buffer.descriptor.label === 'motion-uniforms');
const pov = { heading: 10, pitch: 0, zoom: 1 };

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    gpu = createFakeGpu();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('MotionVectorPass', () => {
    it('builds one labelled pipeline through the checked factory', async () => {
        await ready();
        expect(gpu.renderPipelines.map((p) => p.label)).toEqual(['motion-pipeline']);
    });

    it('is not ready, and hands out no field, before init', () => {
        const pass = new MotionVectorPass(gpu.device);
        expect(pass.isReady()).toBe(false);
        expect(pass.ensureTarget(32, 18)).toBeUndefined();
        expect(pass.encode(gpu.createCommandEncoder(), getSceneDepthFallback(gpu.device))).toBe(false);
    });

    it('the field is rg16float at the intermediate size, reallocated only on resize', async () => {
        const pass = await ready();
        const a = pass.ensureTarget(32, 18);
        expect(pass.ensureTarget(32, 18)).toBe(a);
        expect(live()).toHaveLength(1);
        expect(live()[0]!.descriptor).toMatchObject({ size: [32, 18], format: MOTION_FORMAT });
        pass.ensureTarget(48, 27);
        expect(live().map((t) => t.descriptor.size)).toEqual([[48, 27]]);
    });

    it('draws one triangle into the field with its uniforms in group 0 and scene depth in group 1', async () => {
        const pass = await ready();
        pass.ensureTarget(32, 18);
        const depth = getSceneDepthFallback(gpu.device);
        expect(pass.encode(gpu.createCommandEncoder(), depth)).toBe(true);

        const [motion] = gpu.lastEncoder().passes;
        expect(motion!.label).toBe('motion');
        expect(bindingTexture(motion!.targets[0])).toBe(live()[0]);
        expect(motion!.draws).toEqual([3]);
        const groups = new Map(motion!.bindGroups.map((b) => [b.index, b.group]));
        expect(bindingBuffer((groups.get(0) as RecordedBindGroup).entries.get(0))?.descriptor.label).toBe('motion-uniforms');
        expect(groups.get(1)).toBe(depth);
        expect(pass.getView()).toBe(motion!.targets[0]);
    });

    it('writes its uniforms only when they change', async () => {
        const pass = await ready();
        const u = packMotionUniforms({ mode: 'camera', prev: pov, current: { ...pov, heading: 11 }, width: 32, height: 18 });
        pass.writeUniforms(u);
        pass.writeUniforms(u);
        expect(uniformWrites()).toHaveLength(1);
        pass.writeUniforms(packMotionUniforms({ mode: 'none', prev: pov, current: pov, width: 32, height: 18 }));
        expect(uniformWrites()).toHaveLength(2);
    });

    it('dispose releases the field and stops being ready', async () => {
        const pass = await ready();
        pass.ensureTarget(32, 18);
        pass.dispose();
        expect(pass.isReady()).toBe(false);
        expect(live()).toHaveLength(0);
        expect(pass.getView()).toBeNull();
    });

    it('init after dispose (a teardown racing the shader fetch) builds nothing', async () => {
        const pass = new MotionVectorPass(gpu.device);
        const init = pass.init();
        pass.dispose();
        await init;
        expect(pass.isReady()).toBe(false);
        expect(gpu.renderPipelines).toHaveLength(0);
    });
});
