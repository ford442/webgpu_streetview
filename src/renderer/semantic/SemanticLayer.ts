/**
 * The semantic scene layer's main-bundle face (#352): the lazy `semantic`
 * frame pass and the options the frame driver sets every frame. The
 * controller itself (class-map upload, trust ramp, params packing, sky edge,
 * the class table) is a separate chunk, imported the first time the pass is
 * initialised — the layer is opt-in, so it must not grow the main bundle.
 *
 * Until it is loaded every query answers "no map": no aux (weather binds the
 * zero fallback, so the frame is bit-exact), no sky edge, nothing to encode.
 */
import type { FramePass } from '../framePasses/FramePassRegistry';
import type { AuxSemantic } from './sceneSemanticBinding';
import type { SceneSemanticOptions, SemanticSkyEdge } from './sceneSemanticOptions';
import type { SemanticController, SemanticControllerDeps, SemanticFrameInput } from './SemanticController';
import type { SemanticEffectWeights } from './semanticParams';

/** After `depth` (50), before `streetview` (100). */
const SEMANTIC_PASS_ORDER = 51;

export class SemanticLayer {
    public readonly pass: FramePass;
    private controller: SemanticController | null = null;
    private loading: Promise<SemanticController> | null = null;
    private readonly options: SceneSemanticOptions = { enabled: false, blend: 0, reducedMotion: false };
    private effects: Readonly<SemanticEffectWeights> | null = null;
    private disposed = false;

    constructor(
        private readonly deps: SemanticControllerDeps,
        private readonly importController: () => Promise<typeof import('./SemanticController')> = () => import('./SemanticController'),
    ) {
        this.pass = {
            id: 'semantic',
            order: SEMANTIC_PASS_ORDER,
            lazy: true,
            init: async () => {
                const controller = await this.load();
                await controller.pass.init();
            },
            enabled: (frame) => this.controller?.pass.enabled(frame) ?? false,
            encode: (encoder, frame) => this.controller?.pass.encode(encoder, frame),
            destroy: () => this.dispose(),
        };
    }

    private load(): Promise<SemanticController> {
        this.loading ??= this.importController().then(({ SemanticController: Controller }) => {
            if (this.disposed) throw new Error('the semantic layer was disposed while it loaded');
            const controller = new Controller(this.deps);
            controller.setOptions(this.options);
            if (this.effects) controller.setEffects(this.effects);
            this.controller = controller;
            return controller;
        });
        // A failed chunk load may be retried (switch off and on).
        this.loading.catch(() => {
            this.loading = null;
        });
        return this.loading;
    }

    public getOptions(): Readonly<SceneSemanticOptions> {
        return this.options;
    }

    public setOptions(options: SceneSemanticOptions): void {
        this.options.enabled = options.enabled;
        this.options.blend = options.blend;
        this.options.reducedMotion = options.reducedMotion;
        this.controller?.setOptions(options);
    }

    /** Per-consumer strengths (tests, tools; the presets use the defaults). */
    public setEffects(effects: Readonly<SemanticEffectWeights>): void {
        this.effects = effects;
        this.controller?.setEffects(effects);
    }

    public isInitialised(): boolean {
        return this.controller?.isInitialised() ?? false;
    }

    public needsSession(): boolean {
        return this.controller?.needsSession() ?? false;
    }

    public loadSession(): Promise<void> {
        return this.controller ? this.controller.loadSession() : Promise.resolve();
    }

    public fail(error: unknown): void {
        this.controller?.fail(error);
    }

    public onFrame(frame: SemanticFrameInput): void {
        this.controller?.onFrame(frame);
    }

    public currentAux(): AuxSemantic | undefined {
        return this.controller?.currentAux();
    }

    public currentSkyEdge(): SemanticSkyEdge | null {
        return this.controller?.currentSkyEdge() ?? null;
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.controller?.dispose();
        this.controller = null;
    }
}
