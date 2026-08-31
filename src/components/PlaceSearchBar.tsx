import React from 'react';
import type { UsePlaceSearchResult } from '../hooks/usePlaceSearch';
import { NEARBY_CATEGORY_LABELS, NEARBY_POI_CATEGORIES } from '../search/poiModel';
import { useGeocodeDenied } from '../search/geocodeAuth';

export interface PlaceSearchBarProps {
  search: UsePlaceSearchResult;
  compact?: boolean;
}

const stop = (e: React.SyntheticEvent) => {
  e.stopPropagation();
};

const PlaceSearchBar: React.FC<PlaceSearchBarProps> = ({ search, compact = false }) => {
  const listId = 'place-search-suggestions';
  const geocodeDenied = useGeocodeDenied();

  return (
    <div
      data-testid="place-search"
      onMouseDown={stop}
      onClick={stop}
      onKeyDown={stop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: compact ? 220 : 320,
        maxWidth: compact ? 280 : 420,
        pointerEvents: 'auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search.submit();
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        <input
          role="combobox"
          aria-label="Search a destination"
          aria-autocomplete="list"
          aria-expanded={search.suggestions.length > 0}
          aria-controls={listId}
          placeholder="Place, lat, lng, or pano id"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          autoComplete="off"
          style={{
            flex: 1,
            padding: compact ? '8px 10px' : '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            fontSize: compact ? 13 : 14,
          }}
        />
        <button
          type="submit"
          className="control-btn"
          disabled={search.isSearching}
          aria-label="Go to destination"
          style={{ minWidth: compact ? 56 : 72 }}
        >
          {search.isSearching ? '…' : 'Go'}
        </button>
      </form>

      {geocodeDenied && (
        <div style={{ fontSize: 11, color: 'rgba(255,200,120,0.95)', lineHeight: 1.35 }}>
          Address search needs Geocoding on the HTTP-referrer browser key. Coordinate and pano-id paste still work.
        </div>
      )}

      {search.suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Place suggestions"
          style={{
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: 'rgba(10,10,14,0.95)',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.15)',
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {search.suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                role="option"
                onClick={() => void search.pickSuggestion(s)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      )}

      {search.suggestions.length === 0 && search.query.length === 0 && search.recents.length > 0 && (
        <ul
          aria-label="Recent searches"
          style={{
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: 'rgba(10,10,14,0.9)',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          {search.recents.slice(0, 5).map((r) => (
            <li key={`${r.query}-${r.at}`}>
              <button
                type="button"
                onClick={() => void search.pickRecent(r)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#ccc',
                  padding: '6px 8px',
                  cursor: 'pointer',
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {search.emptyState && (
        <div role="status" style={{ color: '#ffb74d', fontSize: 12, padding: '0 2px' }}>
          {search.emptyState}
        </div>
      )}

      {search.lastResult && search.resultLink && (
        <button
          type="button"
          onClick={() => void search.copyResultLink()}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            color: '#90caf9',
            cursor: 'pointer',
            fontSize: 12,
            padding: 0,
          }}
        >
          Copy link to this search result
        </button>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ddd', fontSize: 12 }}>
        <input
          type="checkbox"
          checked={search.nearbyEnabled}
          onChange={(e) => search.setNearbyEnabled(e.target.checked)}
          aria-label="Show nearby places"
        />
        Nearby POIs
      </label>

      {search.nearbyEnabled && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {NEARBY_POI_CATEGORIES.map((cat) => (
            <label key={cat} style={{ color: '#bbb', fontSize: 11, display: 'flex', gap: 4 }}>
              <input
                type="checkbox"
                checked={search.nearbyCategories.includes(cat)}
                onChange={() => search.toggleNearbyCategory(cat)}
              />
              {NEARBY_CATEGORY_LABELS[cat]}
            </label>
          ))}
        </div>
      )}

      {search.nearbyEnabled && search.nearbyPois.length > 0 && (
        <ul
          aria-label="Nearby places"
          style={{ margin: 0, padding: 4, listStyle: 'none', maxHeight: 140, overflowY: 'auto' }}
        >
          {search.nearbyPois.map((poi) => (
            <li key={poi.id}>
              <button
                type="button"
                onClick={() => search.setSelectedPoi(poi)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#eee',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {NEARBY_CATEGORY_LABELS[poi.category]} · {poi.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PlaceSearchBar;
