/**
 * When to rebuild the renderer after the GPU device is lost — and when to stop.
 *
 * A genuine loss (driver reset, GPU process crash, TDR) is worth a re-init. A
 * loss *we* caused is not: `Renderer` suppresses the `lost` promise of a device
 * it destroyed itself, so those never reach here. What is left can still
 * repeat — a device that dies again right after every boot — so attempts are
 * capped, spaced out with exponential backoff, and end in a terminal
 * "GPU unavailable" state instead of a tight loop that allocates a fresh device
 * each time.
 *
 * Pure (clock injected) so the policy is unit-testable without React or a GPU.
 */

export interface DeviceLossRecoveryOptions {
    /** Re-init attempts per incident before giving up. */
    maxAttempts?: number;
    /** Delay before the first attempt; doubles per attempt. */
    baseDelayMs?: number;
    maxDelayMs?: number;
    /**
     * A renderer that ran this long after its last boot counts as recovered:
     * the next loss starts a fresh incident with the full attempt budget.
     */
    stableAfterMs?: number;
    now?: () => number;
}

export type DeviceLossDecision =
    | { action: 'reinit'; attempt: number; delayMs: number }
    | { action: 'give-up'; attempts: number };

export const DEVICE_LOSS_DEFAULTS = {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 8000,
    stableAfterMs: 30_000,
} as const;

export class DeviceLossRecovery {
    private readonly maxAttempts: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly stableAfterMs: number;
    private readonly now: () => number;

    private attempts = 0;
    private lastBootAt: number | null = null;
    private recovering = false;
    private gaveUp = false;

    constructor(options: DeviceLossRecoveryOptions = {}) {
        this.maxAttempts = options.maxAttempts ?? DEVICE_LOSS_DEFAULTS.maxAttempts;
        this.baseDelayMs = options.baseDelayMs ?? DEVICE_LOSS_DEFAULTS.baseDelayMs;
        this.maxDelayMs = options.maxDelayMs ?? DEVICE_LOSS_DEFAULTS.maxDelayMs;
        this.stableAfterMs = options.stableAfterMs ?? DEVICE_LOSS_DEFAULTS.stableAfterMs;
        this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    }

    /** True between a loss and the boot that recovers from it (or giving up). */
    public isRecovering(): boolean {
        return this.recovering;
    }

    public hasGivenUp(): boolean {
        return this.gaveUp;
    }

    public attemptCount(): number {
        return this.attempts;
    }

    /** A renderer came up (first boot or a re-init). */
    public onBootSucceeded(): void {
        this.lastBootAt = this.now();
        this.recovering = false;
    }

    /** The device was lost underneath a running renderer. */
    public onDeviceLost(): DeviceLossDecision {
        if (this.lastBootAt !== null && this.now() - this.lastBootAt >= this.stableAfterMs) {
            this.attempts = 0;
        }
        return this.next();
    }

    /** A re-init attempt itself failed to boot. Only meaningful while recovering. */
    public onReinitFailed(): DeviceLossDecision {
        return this.next();
    }

    private next(): DeviceLossDecision {
        if (this.gaveUp || this.attempts >= this.maxAttempts) {
            this.gaveUp = true;
            this.recovering = false;
            return { action: 'give-up', attempts: this.attempts };
        }
        this.attempts += 1;
        this.recovering = true;
        const delayMs = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (this.attempts - 1));
        return { action: 'reinit', attempt: this.attempts, delayMs };
    }
}
