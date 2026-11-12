/**
 * panoTimeZone.ts
 *
 * Offline lat/lng → IANA time zone for the in-car clock. No network and no
 * Maps API call (see BILLING_SAFETY_CHECKLIST.md): the lookup table ships with
 * `@photostructure/tz-lookup` and is dynamic-imported so its ~90 KB stays out
 * of the main and car-runtime chunks until a cabin actually asks for a zone.
 *
 * The table trades accuracy for size: a small fraction of points near borders
 * resolve to a zone with a different UTC offset. Fine for a dash clock.
 */

type TzLookup = (lat: number, lng: number) => string;

let lookupPromise: Promise<TzLookup> | null = null;

function loadLookup(): Promise<TzLookup> {
  if (!lookupPromise) {
    lookupPromise = import('@photostructure/tz-lookup')
      .then((mod) => mod.default)
      .catch((err) => {
        // A transient chunk-fetch failure must not poison every later hop.
        lookupPromise = null;
        throw err;
      });
  }
  return lookupPromise;
}

/** Warm the lookup chunk. Never rejects. */
export function preloadTimeZoneLookup(): Promise<void> {
  return loadLookup().then(
    () => undefined,
    () => undefined
  );
}

/**
 * IANA zone for a coordinate, or null when the coordinate is missing/invalid
 * or the lookup could not be loaded. Never rejects.
 */
export async function resolveTimeZone(
  lat: number | null | undefined,
  lng: number | null | undefined
): Promise<string | null> {
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }
  try {
    const lookup = await loadLookup();
    return lookup(lat, lng) || null;
  } catch {
    return null;
  }
}

/** Test-only: forget the memoized lookup so a mocked import is re-evaluated. */
export function resetPanoTimeZoneForTests(): void {
  lookupPromise = null;
}
