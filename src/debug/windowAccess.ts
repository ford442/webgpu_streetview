/**
 * The one place that casts `window` (`readWindowProperty` / `writeWindowProperty`), plus the
 * `?debug` switch. Everything else under `src/` reaches a `window` property through a typed
 * declaration in the module that owns it (`debug/windowAccess.test.ts` greps for stray casts).
 */
import { hasFlag } from '../config/flags';

declare global {
    interface Window {
        /** Internal: the Maps over-quota console guard is installed (survives HMR). */
        __mapsOverQuotaGuard?: boolean;
        /** Safari's prefixed Web Audio constructor. */
        webkitAudioContext?: typeof AudioContext;
    }
}

/** True with `?debug` (any value): install the debug mutators. */
export function isDebugMode(): boolean {
    return hasFlag('debug');
}

/** A `window` property only known by name at runtime (a CDN SDK's global). */
export function readWindowProperty(name: string): unknown {
    return typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>)[name];
}

/** Set (or with `undefined`, delete) a `window` property by name — test mocks of SDK globals. */
export function writeWindowProperty(name: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    const record = window as unknown as Record<string, unknown>;
    if (value === undefined) delete record[name];
    else record[name] = value;
}
