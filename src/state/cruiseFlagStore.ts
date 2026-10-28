/**
 * Whether AppShell's cruise mode is engaged, for the car-mode view (which
 * sits outside the cruise hook's tree). An external store read through
 * `useSyncExternalStore`, so a toggle mid-render cannot tear.
 */
import { createStore, useStore } from './createStore';

const cruiseFlagStore = createStore(false);

export function publishCruiseFlag(on: boolean): void {
  cruiseFlagStore.set(on);
}

/** True while AppShell cruise mode is engaged. */
export function useCruiseFlag(): boolean {
  return useStore(cruiseFlagStore, (on) => on);
}
