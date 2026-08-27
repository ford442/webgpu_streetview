/** Rear-seat vs driver camera for limousine. Unknown wire values are dropped. */
export type CabinView = 'driver' | 'chauffeur';

let desiredCabinView: CabinView = 'driver';

export function isCabinView(value: unknown): value is CabinView {
  return value === 'driver' || value === 'chauffeur';
}

export function setCabinView(view: CabinView): void {
  desiredCabinView = view;
}

export function getCabinView(): CabinView {
  return desiredCabinView;
}
