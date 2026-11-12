/**
 * The atmosphere pass's main-bundle face: the lazy `atmosphere` frame pass and
 * the options the frame driver sets every frame. The controller (pipelines,
 * LUTs, rebuild policy) is its own chunk, imported the first time the pass is
 * initialised — the pass is absent at Low/Medium and opt-in above, so it must
 * not grow the main bundle.
 *
 * Until it is loaded there is nothing to encode, and nothing reads the LUTs:
 * the frame is the pre-atmosphere frame.
 */
import type { FramePass } from '../framePasses/FramePassRegistry';
import type { AtmosphereController, AtmosphereControllerDeps, AtmosphereLuts } from './AtmosphereController';
import { createAtmosphereOptions, type AtmosphereOptions } from './atmosphereOptions';

/** After `depth` (50) and `semantic` (51), before `streetview` (100): built before anything that samples it. */
const ATMOSPHERE_PASS_ORDER = 60;

export class AtmosphereLayer {
    public readonly pass: FramePass;
    private controller: AtmosphereController | null = null;
    private loading: Promise<AtmosphereController> | null = null;
    private readonly options: AtmosphereOptions = createAtmosphereOptions();
    private disposed = false;

    constructor(
        private readonly deps: AtmosphereControllerDeps,
        private readonly importController: () => Promise<typeof import('./AtmosphereController')> = () => import('./AtmosphereController'),
    ) {
        this.pass = {
            id: 'atmosphere',
            order: ATMOSPHERE_PASS_ORDER,
            lazy: true,
            init: async () => {
                const controller = await this.load();
                await controller.pass.init();
            },
            enabled: () => this.controller?.pass.enabled() ?? false,
            encode: (encoder) => this.controller?.pass.encode(encoder),
            destroy: () => this.dispose(),
        };
    }

    private load(): Promise<AtmosphereController> {
        this.loading ??= this.importController().then(({ AtmosphereController: Controller }) => {
            if (this.disposed) throw new Error('the atmosphere layer was disposed while it loaded');
            const controller = new Controller(this.deps);
            controller.setOptions(this.options);
            this.controller = controller;
            return controller;
        });
        // A failed chunk load may be retried (switch off and on).
        this.loading.catch(() => {
            this.loading = null;
        });
        return this.loading;
    }

    public getOptions(): Readonly<AtmosphereOptions> {
        return this.options;
    }

    public setOptions(options: Readonly<AtmosphereOptions>): void {
        Object.assign(this.options, options);
        this.controller?.setOptions(this.options);
    }

    public isInitialised(): boolean {
        return this.controller?.isInitialised() ?? false;
    }

    /** The built LUTs, or null before the first init (slice 2 binds these into weather). */
    public getLuts(): Readonly<AtmosphereLuts> | null {
        return this.controller?.getLuts() ?? null;
    }

    public getBuildCounts(): Readonly<{ medium: number; sun: number }> {
        return this.controller?.getBuildCounts() ?? { medium: 0, sun: 0 };
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.controller?.dispose();
        this.controller = null;
    }
}
