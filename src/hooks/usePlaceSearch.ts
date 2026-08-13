import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSearchQuery } from '../search/parseSearchQuery';
import {
  getPlaceSearchBudget,
  installPlaceSearchKillSwitch,
  PLACE_SEARCH_DEFAULTS,
} from '../search/placeSearchBudget';
import { loadRecentSearches, saveRecentSearch, type RecentSearch } from '../search/recentSearches';
import {
  fetchNearbyPois,
  fetchPlaceSuggestions,
  geocodeTextQuery,
  lookupStreetViewCoverage,
  resolvePlaceId,
  type PlaceSuggestion,
} from '../search/placesClient';
import {
  NEARBY_POI_CATEGORIES,
  type NearbyPoi,
  type NearbyPoiCategory,
} from '../search/poiModel';
import { buildDeepLinkUrl } from '../utils/deepLink';

export interface PlaceSearchApplyTarget {
  lat: number;
  lng: number;
  panoId?: string;
  label: string;
}

export interface UsePlaceSearchOptions {
  teleportSafe: (lat: number, lng: number) => Promise<void>;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  getCurrentPosition: () => { lat: number; lng: number } | null;
  heading: number;
  pitch: number;
  zoom: number;
}

export interface UsePlaceSearchResult {
  query: string;
  setQuery: (value: string) => void;
  suggestions: PlaceSuggestion[];
  recents: RecentSearch[];
  isSearching: boolean;
  emptyState: string | null;
  lastResult: PlaceSearchApplyTarget | null;
  resultLink: string | null;
  nearbyEnabled: boolean;
  setNearbyEnabled: (enabled: boolean) => void;
  nearbyCategories: NearbyPoiCategory[];
  toggleNearbyCategory: (category: NearbyPoiCategory) => void;
  nearbyPois: NearbyPoi[];
  selectedPoi: NearbyPoi | null;
  setSelectedPoi: (poi: NearbyPoi | null) => void;
  submit: (override?: string) => Promise<void>;
  pickSuggestion: (suggestion: PlaceSuggestion) => Promise<void>;
  pickRecent: (recent: RecentSearch) => Promise<void>;
  goToPoi: (poi: NearbyPoi) => Promise<void>;
  copyResultLink: () => Promise<boolean>;
}

export function usePlaceSearch({
  teleportSafe,
  teleportToPanoSafe,
  getCurrentPosition,
  heading,
  pitch,
  zoom,
}: UsePlaceSearchOptions): UsePlaceSearchResult {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [recents, setRecents] = useState<RecentSearch[]>(() =>
    typeof localStorage === 'undefined' ? [] : loadRecentSearches(),
  );
  const [isSearching, setIsSearching] = useState(false);
  const [emptyState, setEmptyState] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PlaceSearchApplyTarget | null>(null);
  const [nearbyEnabled, setNearbyEnabledState] = useState(false);
  const [nearbyCategories, setNearbyCategories] = useState<NearbyPoiCategory[]>([...NEARBY_POI_CATEGORIES]);
  const [nearbyPois, setNearbyPois] = useState<NearbyPoi[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<NearbyPoi | null>(null);
  const debounceRef = useRef<number | null>(null);
  const budget = useMemo(() => getPlaceSearchBudget(), []);

  useEffect(() => {
    installPlaceSearchKillSwitch(budget);
  }, [budget]);

  const resultLink = lastResult
    ? buildDeepLinkUrl({
        lat: lastResult.lat,
        lng: lastResult.lng,
        heading,
        pitch,
        zoom,
        panoId: lastResult.panoId,
      })
    : null;

  const remember = useCallback((entry: Omit<RecentSearch, 'at'>) => {
    setRecents(saveRecentSearch(entry));
  }, []);

  const land = useCallback(
    async (target: PlaceSearchApplyTarget) => {
      const coverage = await lookupStreetViewCoverage(target.lat, target.lng, target.panoId);
      if (!coverage.ok) {
        setEmptyState(
          coverage.reason === 'no-coverage'
            ? 'No Street View coverage at this location.'
            : 'Search is paused (billing guard).',
        );
        return;
      }
      setEmptyState(null);
      const dest: PlaceSearchApplyTarget = {
        lat: coverage.lat ?? target.lat,
        lng: coverage.lng ?? target.lng,
        panoId: coverage.panoId ?? target.panoId,
        label: target.label,
      };
      setLastResult(dest);
      remember({
        query: dest.label,
        label: dest.label,
        lat: dest.lat,
        lng: dest.lng,
        panoId: dest.panoId,
      });
      if (dest.panoId) {
        await teleportToPanoSafe(dest.panoId);
      } else {
        await teleportSafe(dest.lat, dest.lng);
      }
    },
    [remember, teleportSafe, teleportToPanoSafe],
  );

  const submit = useCallback(
    async (override?: string) => {
      const raw = (override ?? query).trim();
      const parsed = parseSearchQuery(raw);
      if (parsed.kind === 'empty') return;
      setIsSearching(true);
      setEmptyState(null);
      try {
        if (parsed.kind === 'coordinates') {
          await land({
            lat: parsed.lat,
            lng: parsed.lng,
            label: `${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`,
          });
          return;
        }
        if (parsed.kind === 'pano') {
          await land({ lat: 0, lng: 0, panoId: parsed.panoId, label: parsed.panoId });
          return;
        }
        const suggestionsNow = suggestions;
        const exact = suggestionsNow.find((s) => s.description.toLowerCase() === parsed.query.toLowerCase());
        if (exact) {
          const resolved = await resolvePlaceId(exact.placeId);
          if (resolved) {
            await land(resolved);
            return;
          }
        }
        const geo = await geocodeTextQuery(parsed.query);
        if (geo) {
          await land(geo);
        } else {
          setEmptyState('No Street View coverage at this location.');
        }
      } finally {
        setIsSearching(false);
      }
    },
    [land, query, suggestions],
  );

  const pickSuggestion = useCallback(
    async (suggestion: PlaceSuggestion) => {
      setQuery(suggestion.description);
      setIsSearching(true);
      try {
        const resolved = await resolvePlaceId(suggestion.placeId);
        if (resolved) await land(resolved);
        else setEmptyState('Could not resolve that place.');
      } finally {
        setIsSearching(false);
      }
    },
    [land],
  );

  const pickRecent = useCallback(
    async (recent: RecentSearch) => {
      setQuery(recent.query);
      if (recent.panoId || (recent.lat != null && recent.lng != null)) {
        await land({
          lat: recent.lat ?? 0,
          lng: recent.lng ?? 0,
          panoId: recent.panoId,
          label: recent.label,
        });
        return;
      }
      await submit(recent.query);
    },
    [land, submit],
  );

  const goToPoi = useCallback(
    async (poi: NearbyPoi) => {
      setSelectedPoi(poi);
      await land({ lat: poi.lat, lng: poi.lng, label: poi.label });
    },
    [land],
  );

  const setNearbyEnabled = useCallback(
    (enabled: boolean) => {
      setNearbyEnabledState(enabled);
      budget.setNearbyEnabled(enabled);
      if (!enabled) {
        setNearbyPois([]);
        setSelectedPoi(null);
      }
    },
    [budget],
  );

  const toggleNearbyCategory = useCallback((category: NearbyPoiCategory) => {
    setNearbyCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  }, []);

  useEffect(() => {
    const parsed = parseSearchQuery(query);
    if (parsed.kind !== 'text') {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void fetchPlaceSuggestions(parsed.query).then(setSuggestions);
    }, PLACE_SEARCH_DEFAULTS.autocompleteDebounceMs);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    if (!nearbyEnabled) return;
    const pos = getCurrentPosition();
    if (!pos || nearbyCategories.length === 0) {
      setNearbyPois([]);
      return;
    }
    let cancelled = false;
    void fetchNearbyPois(pos.lat, pos.lng, nearbyCategories).then((pois) => {
      if (!cancelled) setNearbyPois(pois);
    });
    return () => {
      cancelled = true;
    };
  }, [nearbyEnabled, nearbyCategories, getCurrentPosition, lastResult]);

  const copyResultLink = useCallback(async () => {
    if (!resultLink) return false;
    try {
      await navigator.clipboard.writeText(resultLink);
      return true;
    } catch {
      return false;
    }
  }, [resultLink]);

  return {
    query,
    setQuery,
    suggestions,
    recents,
    isSearching,
    emptyState,
    lastResult,
    resultLink,
    nearbyEnabled,
    setNearbyEnabled,
    nearbyCategories,
    toggleNearbyCategory,
    nearbyPois,
    selectedPoi,
    setSelectedPoi,
    submit,
    pickSuggestion,
    pickRecent,
    goToPoi,
    copyResultLink,
  };
}
