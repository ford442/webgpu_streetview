import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cycleWiperStalk,
  gearHopCount,
  GEAR_POSITIONS,
  setCabinLeverHandlers,
  setCarGear,
  type GearPosition,
  type WiperStalkPosition,
} from '../../car';

/** Spacing between the extra panorama hops a 2/3 gear queues. */
const GEAR_HOP_INTERVAL_MS = 550;

export interface UseGearHopAdvanceOptions {
  advance: (direction: 'forward' | 'backward' | 'left' | 'right', currentHeading?: number) => void;
  carHeading: number;
  setWipers: (enabled: boolean) => void;
}

export interface UseGearHopAdvanceResult {
  gear: GearPosition;
  gearRef: React.MutableRefObject<GearPosition>;
  wiperStalk: WiperStalkPosition;
  chainingHops: number;
  gearPositions: readonly GearPosition[];
  handleNavigate: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
  handleCycleWipers: () => void;
  handleSelectGear: (next: GearPosition) => void;
}

export function useGearHopAdvance({
  advance,
  carHeading,
  setWipers,
}: UseGearHopAdvanceOptions): UseGearHopAdvanceResult {
  const [wiperStalk, setWiperStalkState] = useState<WiperStalkPosition>('off');
  const [gear, setGearState] = useState<GearPosition>('D');
  const gearRef = useRef<GearPosition>('D');
  gearRef.current = gear;
  const pendingHopsRef = useRef<number[]>([]);
  const [chainingHops, setChainingHops] = useState(0);
  const carHeadingRef = useRef(carHeading);
  carHeadingRef.current = carHeading;

  const cancelPendingHops = useCallback(() => {
    for (const id of pendingHopsRef.current) window.clearTimeout(id);
    pendingHopsRef.current = [];
    setChainingHops(0);
  }, []);

  const handleNavigate = useCallback((direction: 'forward' | 'backward' | 'left' | 'right') => {
    const selected = gearRef.current;
    const hops = gearHopCount(selected);
    if (hops === 0) return;

    let resolved = direction;
    if (selected === 'R') {
      if (direction === 'forward') resolved = 'backward';
      else if (direction === 'backward') resolved = 'forward';
    }

    cancelPendingHops();
    advance(resolved, carHeading);
    if ((resolved !== 'forward' && resolved !== 'backward') || hops < 2) return;

    setChainingHops(hops);
    for (let i = 1; i < hops; i++) {
      const id = window.setTimeout(() => {
        if (gearRef.current !== selected) return;
        advance(resolved, carHeadingRef.current);
        if (i === hops - 1) setChainingHops(0);
      }, i * GEAR_HOP_INTERVAL_MS);
      pendingHopsRef.current.push(id);
    }
  }, [advance, carHeading, cancelPendingHops]);

  useEffect(() => {
    setCabinLeverHandlers({
      onWiperStalk: (position) => {
        setWiperStalkState(position);
        setWipers(position !== 'off');
      },
      onGear: (next) => {
        cancelPendingHops();
        setGearState(next);
      },
    });
    return () => setCabinLeverHandlers({});
  }, [setWipers, cancelPendingHops]);

  useEffect(() => cancelPendingHops, [cancelPendingHops]);

  const handleCycleWipers = useCallback(() => {
    const next = cycleWiperStalk();
    setWiperStalkState(next);
    setWipers(next !== 'off');
  }, [setWipers]);

  const handleSelectGear = useCallback((next: GearPosition) => {
    cancelPendingHops();
    setGearState(next);
    setCarGear(next);
  }, [cancelPendingHops]);

  return {
    gear,
    gearRef,
    wiperStalk,
    chainingHops,
    gearPositions: GEAR_POSITIONS,
    handleNavigate,
    handleCycleWipers,
    handleSelectGear,
  };
}
