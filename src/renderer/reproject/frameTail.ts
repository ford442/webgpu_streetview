/**
 * When the road frame's tail (`reproject` → `cabin-composite` → swap chain)
 * is encoded (#331).
 *
 * Every rAF callback of one display frame receives the same timestamp, and
 * the canvas presents only after all of them have run — so a tail encoded in
 * a *later* callback of the same frame still lands in that frame. That is the
 * late latch: `WebGPUCanvas` encodes the road at the top of the frame, the car
 * loop then derives this frame's POV and renders the cabin with it, and only
 * then does the tail re-aim the road at that POV and composite the fresh cabin.
 * Without the deferral both were a frame behind the head pose.
 *
 * The car loop is the **producer**: it calls `producerDone(frameTime)` right
 * after it rendered. A tail is deferred only when the producer finished the
 * *previous* road frame (so it is running and expected) and has not yet
 * finished this one. Everything else runs the tail at once:
 *
 * - no producer (free look): immediately, same frame — nothing to wait for;
 * - the producer already ran this frame (rAF order flipped): immediately;
 * - the producer stopped: the one deferred tail is dropped when the next road
 *   frame arrives (that frame repeats — nothing calls `getCurrentTexture`, so
 *   the canvas keeps its last image, never black), and from then on the
 *   producer counts as gone.
 *
 * Single module instance, like `cabinOverlayRegistry`: the car runtime is a
 * lazy chunk and reaches the scheduler through this module, not a handle.
 */

type FrameTail = () => void;

export interface FrameTailStats {
    /** Tails run in the frame they belong to. */
    ran: number;
    /** Of those, how many waited for the producer. */
    deferred: number;
    /** Deferred tails the producer never released (the frame repeated). */
    dropped: number;
}

export interface FrameTailScheduler {
    /** The road frame's main encode is submitted; run `tail` now or when the producer finishes `frameTime`. */
    submit(frameTime: number, tail: FrameTail): void;
    /** The producer (car loop) has rendered for `frameTime`. */
    producerDone(frameTime: number): void;
    /**
     * Run a still-deferred tail now. A WebXR frame ends with this: the layer's
     * sub-images are invalid after the session's callback returns, so a tail
     * waiting on a car loop that did not run must draw before then.
     */
    flush(): void;
    /** Drop anything pending (renderer teardown, device loss). */
    reset(): void;
    stats(): FrameTailStats;
}

export function createFrameTailScheduler(): FrameTailScheduler {
    let pending: { frameTime: number; tail: FrameTail } | null = null;
    let lastRoadFrame: number | null = null;
    let lastProducerFrame: number | null = null;
    const counts: FrameTailStats = { ran: 0, deferred: 0, dropped: 0 };

    const run = (tail: FrameTail) => {
        counts.ran++;
        try {
            tail();
        } catch (error) {
            console.warn('[frameTail] tail skipped this frame:', error);
        }
    };

    return {
        submit(frameTime, tail) {
            if (pending) {
                counts.dropped++;
                pending = null;
            }
            const producerRunning = lastProducerFrame !== null && lastProducerFrame === lastRoadFrame;
            lastRoadFrame = frameTime;
            if (!producerRunning || lastProducerFrame === frameTime) {
                run(tail);
                return;
            }
            pending = { frameTime, tail };
        },
        producerDone(frameTime) {
            lastProducerFrame = frameTime;
            const p = pending;
            if (!p) return;
            pending = null;
            if (p.frameTime !== frameTime) {
                counts.dropped++;
                return;
            }
            counts.deferred++;
            run(p.tail);
        },
        flush() {
            const p = pending;
            if (!p) return;
            pending = null;
            run(p.tail);
        },
        reset() {
            pending = null;
            lastRoadFrame = null;
            lastProducerFrame = null;
        },
        stats: () => ({ ...counts }),
    };
}

/** The app's one scheduler: `Renderer` submits, the car loop is the producer. */
export const frameTailScheduler: FrameTailScheduler = createFrameTailScheduler();
