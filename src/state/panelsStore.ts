/**
 * Which chrome panels are open, as an external store. The toolbar, keyboard
 * shortcuts and each panel subscribe to what they render, so opening a panel
 * re-renders the chrome — never `AppShell`.
 */
import { createStore, useStore } from './createStore';

const PANEL_IDS = [
  'bookmarks',
  'history',
  'snapshots',
  'colorGrading',
  'weather',
  'looks',
  'accessibility',
  'historicalTimeline',
  'tour',
  'trip',
  'sharedSession',
  'map',
  'storage',
  'performance',
] as const;

export type PanelId = (typeof PANEL_IDS)[number];
type PanelsState = Readonly<Record<PanelId, boolean>>;

const ALL_CLOSED = Object.fromEntries(PANEL_IDS.map((id) => [id, false])) as PanelsState;
const panelsStore = createStore<PanelsState>(ALL_CLOSED);

export function isPanelOpen(id: PanelId): boolean {
  return panelsStore.get()[id];
}

export function setPanelOpen(id: PanelId, open: boolean): void {
  panelsStore.set((s) => (s[id] === open ? s : { ...s, [id]: open }));
}

/** Every panel's state; re-renders on any toggle (the toolbar, the shortcuts). */
export function usePanelsState(): PanelsState {
  return useStore(panelsStore, (s) => s);
}

export function resetPanelsForTests(): void {
  panelsStore.set(ALL_CLOSED);
}
