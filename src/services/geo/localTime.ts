/**
 * localTime.ts
 *
 * Wall-clock time in an IANA time zone (e.g. the panorama's zone), DST-correct
 * via `Intl.DateTimeFormat`. Pure: takes an epoch, returns zero-padded parts.
 */

export interface ZonedClock {
  hh: string;
  mm: string;
  ss: string;
}

/** `null` = the zone is not a valid IANA name for this runtime's ICU data. */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const hit = formatters.get(timeZone);
  if (hit !== undefined) return hit;
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    // `h23` (not `hour12: false`) so local midnight prints 00, never 24.
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    fmt = null; // RangeError: unknown zone — remember so we don't retry per frame
  }
  formatters.set(timeZone, fmt);
  return fmt;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function systemClock(epochMs: number): ZonedClock {
  const d = new Date(epochMs);
  return { hh: pad2(d.getHours()), mm: pad2(d.getMinutes()), ss: pad2(d.getSeconds()) };
}

/**
 * HH/MM/SS at `epochMs` in `timeZone`. A null or unrecognised zone falls back
 * to the viewer's system-local time, which is what the clock showed before it
 * knew about panorama zones.
 */
export function getZonedClock(epochMs: number, timeZone: string | null): ZonedClock {
  const fmt = timeZone ? getFormatter(timeZone) : null;
  if (!fmt) return systemClock(epochMs);

  let hh = '';
  let mm = '';
  let ss = '';
  for (const part of fmt.formatToParts(epochMs)) {
    if (part.type === 'hour') hh = part.value;
    else if (part.type === 'minute') mm = part.value;
    else if (part.type === 'second') ss = part.value;
  }
  return hh && mm && ss ? { hh, mm, ss } : systemClock(epochMs);
}
