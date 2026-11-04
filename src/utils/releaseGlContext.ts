/**
 * Free a throwaway probe context right away. Browsers cap live WebGL contexts
 * (~16) and evict the oldest — which can be the Maps canvas — so a feature
 * probe must not leave its context to the garbage collector.
 */
export function releaseGlContext(gl: unknown): void {
    try {
        (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
        /* already lost */
    }
}
