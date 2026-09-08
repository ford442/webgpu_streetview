import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Characterization tests for the car-mode runtime facade.
 *
 * Written against the pre-split 677-line `carModeRuntime.ts` and must pass
 * unchanged across the split into `car/runtime/`. The module had no test file
 * at all, and its ~55 exported functions all read and write one module-level
 * singleton (`carModeState`, `leverHandlers`). Splitting that across files
 * risks each slice ending up with its *own* copy of the state — a bug
 * typecheck cannot see, because every individual module still compiles.
 *
 * So what is pinned here is: the export surface (a dropped re-export), the
 * null-state guards (defaults before init), and above all **cross-function
 * state sharing** — set through one function, observe through another that
 * would live in a different module after the split.
 *
 * The real cabin needs a WebGLRenderer, which jsdom has not got, so the
 * heavy collaborators are mocked. That is fine here: these tests are about
 * the runtime's own bookkeeping, not about Three.js.
 */

/** Auto-vivifies any accessed method as a spy, so the ~40 delegate calls need no enumeration. */
function autoStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const store: Record<string, unknown> = { ...overrides };
    return new Proxy(store, {
        get(target, prop: string) {
            if (prop in target) return target[prop];
            if (prop === 'then') return undefined; // never look thenable
            const fn = vi.fn();
            target[prop] = fn;
            return fn;
        },
        set(target, prop: string, value) {
            target[prop] = value;
            return true;
        },
    }) as Record<string, unknown>;
}

const madeInteriors: Record<string, unknown>[] = [];

vi.mock('../CarInterior', () => ({
    CarInterior: vi.fn().mockImplementation(() => {
        const interior = autoStub({
            scene: {},
            interiorGroup: {},
            roofGroup: {},
            renderer: {},
            canvas: { style: { cssText: '' }, parentElement: null },
            leftMirrorPlane: {},
            rightMirrorPlane: {},
        });
        madeInteriors.push(interior);
        return interior;
    }),
}));

vi.mock('../RearviewMirror', () => ({
    RearviewMirror: vi.fn().mockImplementation(() => autoStub({
        getStatus: vi.fn(() => ({ rearAvailable: false })),
    })),
}));

vi.mock('../variants', () => ({
    ConvertibleMode: vi.fn().mockImplementation(() => autoStub({
        isConvertibleOpen: vi.fn(() => false),
        toggleRoof: vi.fn(() => true),
        toggleWindDeflector: vi.fn(() => true),
    })),
}));

vi.mock('../SelectivePostProcessing', () => ({
    SelectivePostProcessing: vi.fn().mockImplementation(() => autoStub()),
}));

import * as runtime from '../carModeRuntime';

/** Every name `src/car/index.ts` re-exports from this module. */
const PUBLIC_API = [
    'initCarMode', 'toggleCarMode', 'setMirrorStreetViewCanvas', 'setMirrorRearSample',
    'getMirrorStatus', 'setCarZoomFOV', 'toggleWipers', 'setWiperStalkPosition',
    'cycleWiperStalk', 'getWiperStalkPosition', 'setCarGear', 'getCarGear',
    'getGearHopCount', 'setCabinLeverHandlers', 'setWiperSpeed', 'getWiperState',
    'updateCarMode', 'setCarSteering', 'setCarWipers', 'setCarSeatOffset',
    'setCarLocationInfo', 'setCarCompassHeading', 'setCarPanoEnvironment',
    'setCarSunPosition', 'updateCarGauges', 'toggleCarHeadlights', 'toggleCarDomeLight',
    'setCarHeadlights', 'setCarDomeLight', 'getCarDomeLightState', 'setCarMediaInfo',
    'isCarCenterDisplayHit', 'cycleCarDisplayPage', 'isCarDomeSwitchHit',
    'isCarSteeringWheelHit', 'toggleVehicleType', 'setVehicleType', 'getCurrentVehicleType',
    'toggleConvertibleRoof', 'toggleWindDeflector', 'setWindSpeed', 'setWindowTint',
    'setWindTurbulence', 'isConvertibleOpen', 'setCarRainActive', 'setCarWeatherAmbient',
    'triggerCarInteriorPress', 'setCarInteriorEditMode', 'handleCarInteriorPointerDown',
    'handleCarInteriorPointerMove', 'handleCarInteriorPointerUp', 'setCarWeather',
    'setCarPostProcessingEnabled', 'setCarBloomStrength', 'getCarPerformanceString',
    'disposeCarMode',
] as const;

function container(): HTMLElement {
    return document.createElement('div');
}

beforeEach(() => {
    madeInteriors.length = 0;
    // Each test starts with no live car mode.
    runtime.disposeCarMode();
    runtime.setCabinLeverHandlers({});
});

describe('carModeRuntime — public surface', () => {
    it('exports every function src/car/index.ts re-exports', () => {
        for (const name of PUBLIC_API) {
            expect(typeof (runtime as Record<string, unknown>)[name], name).toBe('function');
        }
    });
});

describe('carModeRuntime — guards before init', () => {
    it('returns documented defaults with no car mode running', () => {
        expect(runtime.getCarGear()).toBe('D');
        expect(runtime.getWiperStalkPosition()).toBe('off');
        expect(runtime.getWiperState()).toEqual({ enabled: false, speed: 1.0 });
        expect(runtime.getMirrorStatus()).toBeNull();
        expect(runtime.isConvertibleOpen()).toBe(false);
        expect(runtime.toggleWipers()).toBe(false);
        expect(runtime.cycleWiperStalk()).toBe('off');
        expect(runtime.toggleConvertibleRoof()).toBe(false);
        expect(runtime.getCarDomeLightState()).toBe(false);
    });

    it('does not throw when driven with no car mode running', () => {
        expect(() => {
            runtime.toggleCarMode(true);
            runtime.updateCarMode(0, 0, 0);
            runtime.setCarGear('P');
            runtime.setCarSteering(0.5);
            runtime.setWiperSpeed(2);
            runtime.setCarZoomFOV(1);
            runtime.setMirrorRearSample(null);
            runtime.disposeCarMode();
        }).not.toThrow();
    });
});

describe('carModeRuntime — singleton state is shared across functions', () => {
    // This is the block that would fail if the split gave each slice its own
    // copy of `carModeState`: every case writes through one function and reads
    // back through another that lands in a *different* module.

    it('shares wiper state between the stalk, speed and query functions', () => {
        runtime.initCarMode(container());

        runtime.setWiperStalkPosition('high');
        expect(runtime.getWiperStalkPosition()).toBe('high');
        expect(runtime.getWiperState().enabled).toBe(true);

        runtime.setWiperStalkPosition('off');
        expect(runtime.getWiperState().enabled).toBe(false);
    });

    it('cycles the stalk through its detents and wraps back to off', () => {
        runtime.initCarMode(container());
        const seen = [
            runtime.cycleWiperStalk(),
            runtime.cycleWiperStalk(),
            runtime.cycleWiperStalk(),
            runtime.cycleWiperStalk(),
        ];
        expect(seen[seen.length - 1]).toBe('off');
        expect(new Set(seen).size).toBeGreaterThan(1);
        expect(runtime.getWiperStalkPosition()).toBe('off');
    });

    it('toggleWipers flips through the stalk, not a separate flag', () => {
        runtime.initCarMode(container());
        expect(runtime.toggleWipers()).toBe(true);
        expect(runtime.getWiperStalkPosition()).toBe('low');
        expect(runtime.toggleWipers()).toBe(false);
        expect(runtime.getWiperStalkPosition()).toBe('off');
    });

    it('shares gear state between setter, getter and hop count', () => {
        runtime.initCarMode(container());
        runtime.setCarGear('P');
        expect(runtime.getCarGear()).toBe('P');
        // Parked consumes no panorama hops.
        expect(runtime.getGearHopCount()).toBe(0);

        runtime.setCarGear('D');
        expect(runtime.getCarGear()).toBe('D');
        expect(runtime.getGearHopCount()).toBeGreaterThan(0);
    });

    it('shares vehicle state between the switch and the query', () => {
        runtime.initCarMode(container());
        runtime.setVehicleType('convertible');
        expect(runtime.getCurrentVehicleType()).toBe('convertible');
        runtime.setVehicleType('limousine');
        expect(runtime.getCurrentVehicleType()).toBe('limousine');
    });

    it('toggleVehicleType flips sedan <-> convertible through the shared state', () => {
        runtime.initCarMode(container());
        runtime.setVehicleType('sedan');
        expect(runtime.toggleVehicleType()).toBe('convertible');
        expect(runtime.getCurrentVehicleType()).toBe('convertible');
        expect(runtime.toggleVehicleType()).toBe('sedan');
    });
});

describe('carModeRuntime — lever handlers reach the registered listener', () => {
    it('notifies the wiper-stalk handler registered separately from the mover', () => {
        runtime.initCarMode(container());
        const onWiperStalk = vi.fn();
        runtime.setCabinLeverHandlers({ onWiperStalk });

        runtime.setWiperStalkPosition('intermittent');
        expect(onWiperStalk).toHaveBeenCalledWith('intermittent');
    });

    it('notifies the gear handler', () => {
        runtime.initCarMode(container());
        const onGear = vi.fn();
        runtime.setCabinLeverHandlers({ onGear });

        runtime.setCarGear('R');
        expect(onGear).toHaveBeenCalledWith('R');
    });

    it('does not re-notify when the stalk is set to where it already is', () => {
        runtime.initCarMode(container());
        runtime.setWiperStalkPosition('low');
        const onWiperStalk = vi.fn();
        runtime.setCabinLeverHandlers({ onWiperStalk });

        runtime.setWiperStalkPosition('low');
        expect(onWiperStalk).not.toHaveBeenCalled();
    });
});

describe('carModeRuntime — lifecycle', () => {
    it('builds exactly one interior per init', () => {
        runtime.initCarMode(container());
        expect(madeInteriors).toHaveLength(1);
    });

    it('toggleCarMode drives the interior active flag and canvas visibility', () => {
        runtime.initCarMode(container());
        const interior = madeInteriors[0]!;

        runtime.toggleCarMode(true);
        expect(interior.setActive).toHaveBeenCalledWith(true);
        expect((interior.canvas as { style: { cssText: string } }).style.cssText).toContain('display: block');

        runtime.toggleCarMode(false);
        expect(interior.setActive).toHaveBeenCalledWith(false);
        expect((interior.canvas as { style: { cssText: string } }).style.cssText).toContain('display: none');
    });

    it('updateCarMode is inert until car mode is active', () => {
        runtime.initCarMode(container());
        const interior = madeInteriors[0]!;

        runtime.updateCarMode(10, 0, 0);
        expect(interior.update).not.toHaveBeenCalled();

        runtime.toggleCarMode(true);
        runtime.updateCarMode(10, 0, 0);
        expect(interior.update).toHaveBeenCalled();
    });

    it('dispose clears the singleton so the guards apply again', () => {
        runtime.initCarMode(container());
        runtime.setCarGear('P');
        expect(runtime.getCarGear()).toBe('P');

        runtime.disposeCarMode();

        // Back to the pre-init default, not the last live value.
        expect(runtime.getCarGear()).toBe('D');
        expect(runtime.getMirrorStatus()).toBeNull();
    });
});
