/**
 * `RuntimeContexts` — the one answer to "what is this machine and what may we
 * use" (#361 slice 1).
 *
 * Every subsystem that used to probe the browser on its own (the road's
 * adapter policy, the canvas HDR / P3 gates, the cabin overlay's colour space,
 * the battery heuristic, the quality hook's battery saver) reads this module
 * instead. It is the **only** place under `src/` that calls `matchMedia` for
 * `(dynamic-range: high)` / `(color-gamut: p3)` or reads `navigator.getBattery`
 * (`contexts.scan.test.ts` enforces it).
 *
 * The snapshot is frozen and replaced, never mutated: `getRuntimeContexts()`
 * is safe to hand out, and `subscribeRuntimeContexts` fires on each new one.
 * Sections fill in as they become known:
 *
 *   - `display`, `isolation`, `power.saveData` — synchronously, on first read;
 *   - `power.battery`, `storage`, `display.refreshHz` — by `startRuntimeContexts()`
 *     (boot), asynchronously;
 *   - `gpu` — by `bootDevice` once the adapter exists (`recordGpuContext`);
 *   - `audio` — by `audio/audioRuntime.ts` when it creates the one context.
 *
 * Display changes (a window dragged to another monitor) update `display` and
 * notify `subscribeDisplayChanges` listeners; `WebGPUCanvas` re-runs the canvas
 * configure through `deviceInit`'s builder when the resolved policy moves.
 *
 * Published on `window.__SV__.contexts`.
 */
import { createStore } from '../state/createStore';
import { requestFrame } from '../xr/frameClock';

export interface GpuAdapterIdentity {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
}

export interface GpuContext {
    /** The `requestAdapter` options the road's adapter was obtained with. */
    requestOptions: Readonly<GPURequestAdapterOptions>;
    adapterInfo: Readonly<GpuAdapterIdentity>;
    /** Adapter features (what could be asked for), sorted. */
    features: readonly string[];
    /** Features actually enabled on the road's device. */
    enabledFeatures: readonly string[];
    limits: Readonly<Record<string, number>>;
    featureLevel: 'core' | 'compatibility' | 'unknown';
    xrCompatible: boolean;
}

export interface DisplayContext {
    /** `matchMedia('(dynamic-range: high)')`. */
    hdr: boolean;
    /** `matchMedia('(color-gamut: p3)')`. */
    p3: boolean;
    /** Measured over `REFRESH_SAMPLE_FRAMES` frames at boot; null until measured. */
    refreshHz: number | null;
}

interface AudioOutputContext {
    /** Null until `audio/audioRuntime.ts` creates the one AudioContext. */
    sampleRate: number | null;
    baseLatency: number | null;
    outputLatency: number | null;
}

interface StorageContext {
    quota: number | null;
    usage: number | null;
}

export interface BatteryState {
    charging: boolean;
    level: number;
}

interface PowerContext {
    /** Null where the Battery API is absent (or not read yet). */
    battery: Readonly<BatteryState> | null;
    /** `navigator.connection.saveData`. */
    saveData: boolean;
}

export interface RuntimeContexts {
    gpu: Readonly<GpuContext> | null;
    display: Readonly<DisplayContext>;
    audio: Readonly<AudioOutputContext>;
    /** `crossOriginIsolated` — SharedArrayBuffer (cabin param ring) is available. */
    isolation: boolean;
    storage: Readonly<StorageContext>;
    power: Readonly<PowerContext>;
}

/** Frames the boot refresh-rate measurement averages over. */
const REFRESH_SAMPLE_FRAMES = 30;

const HDR_QUERY = '(dynamic-range: high)';
const P3_QUERY = '(color-gamut: p3)';

function matchQuery(query: string): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    try {
        return window.matchMedia(query);
    } catch {
        return null;
    }
}

function readDisplayQueries(): { hdr: boolean; p3: boolean } {
    return {
        hdr: matchQuery(HDR_QUERY)?.matches === true,
        p3: matchQuery(P3_QUERY)?.matches === true,
    };
}

function readSaveData(): boolean {
    if (typeof navigator === 'undefined') return false;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return connection?.saveData === true;
}

function readIsolation(): boolean {
    return typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false;
}

function freeze(contexts: RuntimeContexts): Readonly<RuntimeContexts> {
    Object.freeze(contexts.display);
    Object.freeze(contexts.audio);
    Object.freeze(contexts.storage);
    if (contexts.power.battery) Object.freeze(contexts.power.battery);
    Object.freeze(contexts.power);
    if (contexts.gpu) Object.freeze(contexts.gpu);
    return Object.freeze(contexts);
}

function initialContexts(): Readonly<RuntimeContexts> {
    return freeze({
        gpu: null,
        display: { ...readDisplayQueries(), refreshHz: null },
        audio: { sampleRate: null, baseLatency: null, outputLatency: null },
        isolation: readIsolation(),
        storage: { quota: null, usage: null },
        power: { battery: null, saveData: readSaveData() },
    });
}

let store = createStore<Readonly<RuntimeContexts>>(initialContexts());
let started = false;
let teardown: Array<() => void> = [];
const displayListeners = new Set<(display: Readonly<DisplayContext>) => void>();
let batteryRead: Promise<BatteryState | null> | null = null;

function update(patch: (prev: Readonly<RuntimeContexts>) => RuntimeContexts): void {
    store.set((prev) => freeze(patch(prev)));
}

/** The current frozen snapshot. */
export function getRuntimeContexts(): Readonly<RuntimeContexts> {
    return store.get();
}

export function subscribeRuntimeContexts(listener: () => void): () => void {
    return store.subscribe(listener);
}

/**
 * The display's HDR / P3 capability, as of now. Re-reads the media queries
 * (so a caller before `startRuntimeContexts` still gets the truth) and folds
 * the result into the snapshot.
 */
export function readDisplayCapabilities(): { hdr: boolean; p3: boolean } {
    const now = readDisplayQueries();
    const prev = store.get().display;
    if (prev.hdr !== now.hdr || prev.p3 !== now.p3) {
        update((c) => ({ ...c, display: { ...c.display, ...now } }));
    }
    return now;
}

/** Called when the display's HDR / P3 answer changes (not for the refresh measurement). */
export function subscribeDisplayChanges(listener: (display: Readonly<DisplayContext>) => void): () => void {
    displayListeners.add(listener);
    return () => {
        displayListeners.delete(listener);
    };
}

interface BatteryManagerLike extends BatteryState {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * The battery, read once (later calls share the first read); null where the
 * Battery API is absent or refuses. Level / charging changes keep the snapshot
 * current after that.
 */
export function readBatteryState(): Promise<BatteryState | null> {
    if (batteryRead) return batteryRead;
    const api = typeof navigator === 'undefined'
        ? undefined
        : (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery;
    if (typeof api !== 'function') {
        batteryRead = Promise.resolve(null);
        return batteryRead;
    }
    batteryRead = api.call(navigator).then((battery) => {
        const publish = (): BatteryState => {
            const state = { charging: battery.charging === true, level: Number(battery.level) };
            update((c) => ({ ...c, power: { ...c.power, battery: state } }));
            return state;
        };
        if (typeof battery.addEventListener === 'function') {
            battery.addEventListener('levelchange', publish);
            battery.addEventListener('chargingchange', publish);
            teardown.push(() => {
                battery.removeEventListener?.('levelchange', publish);
                battery.removeEventListener?.('chargingchange', publish);
            });
        }
        return publish();
    }, () => null);
    return batteryRead;
}

/** Adapter features as a sorted list; tolerant of a partial `GPUSupportedFeatures`. */
function featureList(features: GPUSupportedFeatures | undefined): string[] {
    if (!features || typeof (features as Partial<Iterable<string>>)[Symbol.iterator] !== 'function') return [];
    return [...features].sort();
}

/** Every numeric member of a `GPUSupportedLimits` (they live on its prototype chain). */
function limitRecord(source: GPUSupportedLimits | undefined): Record<string, number> {
    const limits: Record<string, number> = {};
    if (!source) return limits;
    for (let proto: object | null = source; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === 'constructor' || name in limits) continue;
            const value = (source as unknown as Record<string, unknown>)[name];
            if (typeof value === 'number') limits[name] = value;
        }
    }
    return limits;
}

/**
 * `bootDevice`: the road's adapter exists. Diagnostics only — never throws,
 * whatever shape the adapter has.
 */
export function recordGpuContext(
    adapter: GPUAdapter,
    requestOptions: GPURequestAdapterOptions,
    enabledFeatures: readonly GPUFeatureName[],
): void {
    // `info` is typed since @webgpu/types 0.1.71; a browser that predates it has none.
    const info = adapter.info as GPUAdapterInfo | undefined;
    const featureLevel = (requestOptions as { featureLevel?: 'core' | 'compatibility' }).featureLevel;
    const gpu: GpuContext = {
        requestOptions: Object.freeze({ ...requestOptions }),
        adapterInfo: Object.freeze({
            vendor: info?.vendor ?? '',
            architecture: info?.architecture ?? '',
            device: info?.device ?? '',
            description: info?.description ?? '',
        }),
        features: Object.freeze(featureList(adapter.features)),
        enabledFeatures: Object.freeze([...enabledFeatures]),
        limits: Object.freeze(limitRecord(adapter.limits)),
        featureLevel: featureLevel ?? 'unknown',
        xrCompatible: requestOptions.xrCompatible === true,
    };
    update((c) => ({ ...c, gpu }));
}

/** `audio/audioRuntime.ts`: the one AudioContext exists. */
export function recordAudioOutput(ctx: Pick<AudioContext, 'sampleRate'> & Partial<Pick<AudioContext, 'baseLatency' | 'outputLatency'>>): void {
    const finite = (v: number | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    update((c) => ({
        ...c,
        audio: {
            sampleRate: finite(ctx.sampleRate),
            baseLatency: finite(ctx.baseLatency),
            outputLatency: finite(ctx.outputLatency),
        },
    }));
}

/** Median frame interval → Hz, rounded; null for an unusable sample. */
export function refreshHzFromFrameTimes(times: readonly number[]): number | null {
    if (times.length < 3) return null;
    const deltas: number[] = [];
    for (let i = 1; i < times.length; i++) {
        const d = times[i]! - times[i - 1]!;
        if (d > 0 && Number.isFinite(d)) deltas.push(d);
    }
    if (deltas.length < 2) return null;
    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)]!;
    return median > 0 ? Math.round(1000 / median) : null;
}

function measureRefreshRate(): void {
    const times: number[] = [];
    let cancelled = false;
    const tick = (time: number): void => {
        if (cancelled) return;
        times.push(time);
        if (times.length <= REFRESH_SAMPLE_FRAMES) {
            requestFrame(tick);
            return;
        }
        const refreshHz = refreshHzFromFrameTimes(times);
        update((c) => ({ ...c, display: { ...c.display, refreshHz } }));
    };
    requestFrame(tick);
    teardown.push(() => {
        cancelled = true;
    });
}

function watchDisplayQueries(): void {
    for (const query of [HDR_QUERY, P3_QUERY]) {
        const list = matchQuery(query);
        if (!list || typeof list.addEventListener !== 'function') continue;
        const onChange = (): void => {
            const prev = store.get().display;
            const now = readDisplayQueries();
            if (prev.hdr === now.hdr && prev.p3 === now.p3) return;
            update((c) => ({ ...c, display: { ...c.display, ...now } }));
            const display = store.get().display;
            for (const listener of Array.from(displayListeners)) listener(display);
        };
        list.addEventListener('change', onChange);
        teardown.push(() => list.removeEventListener('change', onChange));
    }
}

function readStorageEstimate(): void {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (typeof storage?.estimate !== 'function') return;
    storage.estimate().then((estimate) => {
        update((c) => ({
            ...c,
            storage: { quota: estimate.quota ?? null, usage: estimate.usage ?? null },
        }));
    }, () => undefined);
}

/**
 * Boot: start the asynchronous reads (battery, storage, refresh rate) and the
 * display-change listeners. Idempotent.
 */
export function startRuntimeContexts(): void {
    if (started || typeof window === 'undefined') return;
    started = true;
    watchDisplayQueries();
    void readBatteryState();
    readStorageEstimate();
    measureRefreshRate();
}

/** Test-only: forget everything (listeners, the battery read, the snapshot). */
export function resetRuntimeContextsForTests(): void {
    for (const fn of teardown.splice(0)) fn();
    teardown = [];
    started = false;
    batteryRead = null;
    displayListeners.clear();
    store = createStore<Readonly<RuntimeContexts>>(initialContexts());
}
