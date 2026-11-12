/**
 * The one spelling for a promise whose failure genuinely does not matter
 * (best-effort prefetch, `AudioContext.close()` on teardown, autoplay that the
 * browser may refuse): `promise.catch(ignoreRejection)`. Anything whose failure
 * matters is awaited or handled; a bare `.catch(() => {})` is a lint error so
 * "ignored on purpose" stays greppable.
 */
export function ignoreRejection(): void {
  // Deliberately empty.
}
