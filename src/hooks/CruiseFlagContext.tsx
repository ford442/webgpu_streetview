import { useEffect, useState } from 'react';

let cruiseFlag = false;
const listeners = new Set<(on: boolean) => void>();

export function publishCruiseFlag(on: boolean): void {
  cruiseFlag = on;
  listeners.forEach((fn) => fn(on));
}

/** True while AppShell cruise mode is engaged. */
export function useCruiseFlag(): boolean {
  const [value, setValue] = useState(cruiseFlag);
  useEffect(() => {
    listeners.add(setValue);
    setValue(cruiseFlag);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
