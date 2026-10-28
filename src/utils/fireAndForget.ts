/**
 * Adapt an async handler to a void-returning callback prop
 * (`no-misused-promises`): the promise is not dropped on the floor — a
 * rejection is logged with `label` (and still counted by the app's
 * `unhandledrejection` reporter if logging itself throws).
 */
export function fireAndForget<A extends unknown[]>(
  label: string,
  fn: (...args: A) => Promise<unknown> | void,
): (...args: A) => void {
  return (...args) => {
    Promise.resolve(fn(...args)).catch((err: unknown) => {
      console.warn(`[${label}]`, err);
    });
  };
}
