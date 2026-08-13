export interface RecentSearch {
  query: string;
  label: string;
  lat?: number;
  lng?: number;
  panoId?: string;
  at: number;
}

export const RECENT_SEARCHES_KEY = 'webgpu_streetview_recent_searches';
const MAX_RECENT = 12;

export function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentSearch).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecentSearch(entry: Omit<RecentSearch, 'at'>): RecentSearch[] {
  const next: RecentSearch = { ...entry, at: Date.now() };
  const existing = loadRecentSearches().filter(
    (item) => item.query.toLowerCase() !== next.query.toLowerCase(),
  );
  const list = [next, ...existing].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
  return list;
}

function isRecentSearch(value: unknown): value is RecentSearch {
  if (!value || typeof value !== 'object') return false;
  const rec = value as RecentSearch;
  return typeof rec.query === 'string' && typeof rec.label === 'string';
}
