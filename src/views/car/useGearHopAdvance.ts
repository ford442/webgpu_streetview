import { useCallback, useEffect, useRef, useState } from 'react';
import { gearHopCount, GEAR_POSITIONS, setCabinLeverHandlers, setCarGear, type GearPosition, type WiperStalkPosition, cycleWiperStalk } from '../../car';
import { gearChainedHopIntervalMs } from '../../car/VehicleDynamics';
import { povStore } from '../../state/povStore';

export interface UseGearHopAdvanceOptions {
  advance: (direction: 'forward' | 'backward' | 'left' | 'right', currentHeading?: number) => void;
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
  setWipers,
}: UseGearHopAdvanceOptions): UseGearHopAdvanceResult {
  const [wiperStalk, setWiperStalkState] = useState<WiperStalkPosition>('off');
  const [gear, setGearState] = useState<GearPosition>('D');
  const gearRef = useRef<GearPosition>('D');
  gearRef.current = gear;
  const pendingHopsRef = useRef<number[]>([]);
  const [chainingHops, setChainingHops] = useState(0);

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
    advance(resolved, povStore.get().carHeading);
    if ((resolved !== 'forward' && resolved !== 'backward') || hops < 2) return;

    setChainingHops(hops);
    for (let i = 1; i < hops; i++) {
      const id = window.setTimeout(() => {
        if (gearRef.current !== selected) return;
        advance(resolved, povStore.get().carHeading);
        if (i === hops - 1) setChainingHops(0);
      }, i * gearChainedHopIntervalMs(hops));
      pendingHopsRef.current.push(id);
    }
  }, [advance, cancelPendingHops]);

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
