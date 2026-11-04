/**
 * The semantic layer's main-bundle face (#352): nothing of the controller
 * loads until the pass is initialised, options and effect weights set before
 * that reach it, and a failed chunk load fails the pass and can be retried.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SemanticControllerDeps } from './SemanticController';
import { SemanticLayer } from './SemanticLayer';

function fakeController() {
    return {
        pass: { init: vi.fn(async () => undefined), enabled: vi.fn(() => true), encode: vi.fn() },
        setOptions: vi.fn(),
        setEffects: vi.fn(),
        isInitialised: vi.fn(() => true),
        needsSession: vi.fn(() => false),
        loadSession: vi.fn(async () => undefined),
        fail: vi.fn(),
        onFrame: vi.fn(),
        currentAux: vi.fn(() => undefined),
        currentSkyEdge: vi.fn(() => ({ y: 0.4, pitch: 0.5, seq: 1 })),
        dispose: vi.fn(),
    };
}

const deps = {} as SemanticControllerDeps;

function makeLayer(load?: () => Promise<never>) {
    const controller = fakeController();
    const Controller = vi.fn(function (this: unknown) {
        return controller;
    });
    const importer = vi.fn(load ?? (async () => ({ SemanticController: Controller }) as never));
    return { layer: new SemanticLayer(deps, importer), controller, Controller, importer };
}

describe('SemanticLayer', () => {
    it('is a lazy, optional pass that imports nothing until it is initialised', () => {
        const { layer, importer } = makeLayer();
        expect(layer.pass.id).toBe('semantic');
        expect(layer.pass.lazy).toBe(true);
        expect(layer.pass.required).toBeFalsy();
        layer.setOptions({ enabled: true, blend: 1, reducedMotion: false });
        layer.onFrame({ nowMs: 0, view: { panX: 0, panY: 0.5, zoom: 1 } });
        expect(importer).not.toHaveBeenCalled();
        // No controller: no map, no sky edge, nothing to encode.
        expect(layer.currentAux()).toBeUndefined();
        expect(layer.currentSkyEdge()).toBeNull();
        expect(layer.pass.enabled({} as never)).toBe(false);
        expect(layer.isInitialised()).toBe(false);
        expect(layer.needsSession()).toBe(false);
    });

    it('hands the options and effects set before loading to the controller, then delegates', async () => {
        const { layer, controller, Controller } = makeLayer();
        layer.setOptions({ enabled: true, blend: 0.8, reducedMotion: true });
        layer.setEffects({ rainSky: 1, wetRoad: 0, snowCover: 1, fogSky: 1, relight: 1, skyReplace: 0 });
        await layer.pass.init();
        expect(Controller).toHaveBeenCalledWith(deps);
        expect(controller.setOptions).toHaveBeenCalledWith({ enabled: true, blend: 0.8, reducedMotion: true });
        expect(controller.setEffects).toHaveBeenCalledWith(expect.objectContaining({ wetRoad: 0, skyReplace: 0 }));
        expect(controller.pass.init).toHaveBeenCalledTimes(1);

        layer.onFrame({ nowMs: 1, view: { panX: 0, panY: 0.5, zoom: 1 } });
        expect(controller.onFrame).toHaveBeenCalledTimes(1);
        expect(layer.currentSkyEdge()).toEqual({ y: 0.4, pitch: 0.5, seq: 1 });
        layer.pass.encode({} as never, {} as never);
        expect(controller.pass.encode).toHaveBeenCalledTimes(1);

        layer.pass.destroy();
        expect(controller.dispose).toHaveBeenCalledTimes(1);
        expect(layer.currentSkyEdge()).toBeNull();
    });

    it('a failed chunk load rejects init and is retried on the next init', async () => {
        let fail = true;
        const controller = fakeController();
        const Controller = vi.fn(function (this: unknown) {
            return controller;
        });
        const layer = new SemanticLayer(deps, async () => {
            if (fail) throw new Error('Failed to fetch dynamically imported module');
            return { SemanticController: Controller } as never;
        });
        await expect(layer.pass.init()).rejects.toThrow(/dynamically imported/);
        fail = false;
        await layer.pass.init();
        expect(controller.pass.init).toHaveBeenCalledTimes(1);
    });

    it('a layer disposed while its chunk loads never builds the controller', async () => {
        const { layer, Controller } = makeLayer();
        const init = layer.pass.init();
        layer.dispose();
        await expect(init).rejects.toThrow(/disposed/);
        expect(Controller).not.toHaveBeenCalled();
    });
});
