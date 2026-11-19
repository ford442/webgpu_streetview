/**
 * What a virtual frame step waits for (#374, `services/capture/virtualFrameStepper.ts`):
 * the renderer's per-frame inputs that arrive asynchronously. Here (foundation)
 * because the renderer reports it and the capture service reads it.
 */

/**
 * One asynchronous input's state:
 * - `off` — not in use (switched off, failed, or unsupported): nothing to wait for;
 * - `busy` — work in flight whose result the next frame should include
 *   (a model download, an inference, a lazy chunk);
 * - `idle` — in use and current.
 */
export type FrameInputWork = 'off' | 'busy' | 'idle';

export interface FrameInputsState {
    /** A hop's hold is up: the live Maps canvas must not be uploaded, so a step waits. */
    holdActive: boolean;
    /** Scene depth (#320): the estimator loading or an inference in flight. */
    depth: FrameInputWork;
    /** The semantic layer (#352): its chunk or session loading (its maps ride depth's inferences). */
    semantic: FrameInputWork;
}
