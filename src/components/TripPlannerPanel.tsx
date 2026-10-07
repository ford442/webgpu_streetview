import React, { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useKeyboardShortcuts';
import { fetchPlaceSuggestions, resolvePlaceId, type PlaceSuggestion } from '../search/placesClient';
import { PLACE_SEARCH_DEFAULTS } from '../search/placeSearchBudget';
import { formatEta, formatGuidanceDistance, maneuverInstruction } from '../services/routing/guidanceFormat';
import { parseLatLngText } from '../services/routing/routeLink';
import { downloadTextFile, routeToGpx } from '../services/routing/routeExport';
import { nextStep, useTripSelector, type TripStop } from '../state/tripStore';
import { TRIP_OFFLINE_SPACING_M, type TripPanelBindings } from '../app/useTripBindings';

interface TripPlannerPanelProps extends TripPanelBindings {
  isOpen: boolean;
  onClose: () => void;
}

/** Via-points between the origin and the destination. */
export const MAX_VIA_POINTS = 3;

interface StopDraft {
  text: string;
  stop: TripStop | null;
}

const EMPTY_DRAFT: StopDraft = { text: '', stop: null };

const btn = (bg: string, disabled = false): React.CSSProperties => ({
  padding: '8px 12px',
  background: disabled ? 'rgba(255,255,255,0.08)' : bg,
  color: disabled ? '#888' : '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 13,
  fontWeight: 600,
});

const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

/**
 * One stop field: free text goes through the (budgeted) place search, a typed
 * "lat, lng" is used as-is with no lookup.
 */
function StopField({
  label,
  draft,
  onChange,
  onRemove,
}: {
  label: string;
  draft: StopDraft;
  onChange: (next: StopDraft) => void;
  onRemove?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const inputId = useRef(`trip-stop-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const text = draft.text.trim();
    if (draft.stop || text.length < 3 || parseLatLngText(text)) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void fetchPlaceSuggestions(text).then((s) => {
        if (!cancelled) setSuggestions(s.slice(0, 5));
      });
    }, PLACE_SEARCH_DEFAULTS.autocompleteDebounceMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft.text, draft.stop]);

  const commitText = (): void => {
    const p = parseLatLngText(draft.text);
    if (p) onChange({ text: draft.text, stop: { ...p, label: draft.text.trim() } });
  };

  const pick = async (s: PlaceSuggestion): Promise<void> => {
    setBusy(true);
    setSuggestions([]);
    const resolved = await resolvePlaceId(s.placeId);
    setBusy(false);
    onChange(resolved
      ? { text: s.description, stop: { lat: resolved.lat, lng: resolved.lng, label: s.description } }
      : { text: s.description, stop: null });
  };

  return (
    <div style={{ marginBottom: 10, position: 'relative' }}>
      <label htmlFor={inputId} style={{ display: 'block', color: '#aaa', fontSize: 12, marginBottom: 4 }}>
        {label} {draft.stop && <span aria-label="location set" style={{ color: '#4CAF50' }}>✓</span>}
        {busy && <span style={{ color: '#aaa' }}> resolving…</span>}
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          id={inputId}
          type="text"
          value={draft.text}
          placeholder="Place name or lat, lng"
          autoComplete="off"
          onChange={(e) => onChange({ text: e.target.value, stop: null })}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitText();
          }}
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #555',
            background: '#1b1b1b', color: '#fff', fontSize: 13,
          }}
        />
        {onRemove && (
          <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} style={btn('rgba(255,255,255,0.12)')}>
            ×
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label={`${label} suggestions`}
          style={{
            listStyle: 'none', margin: '4px 0 0', padding: 0, background: '#222',
            border: '1px solid #444', borderRadius: 6, maxHeight: 180, overflowY: 'auto',
          }}
        >
          {suggestions.map((s) => (
            <li key={s.placeId} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => void pick(s)}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none',
                  border: 'none', color: '#ddd', cursor: 'pointer', fontSize: 13,
                }}
              >
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TripPlannerPanel: React.FC<TripPlannerPanelProps> = ({
  isOpen,
  onClose,
  routing,
  getOrigin,
  onPlan,
  onDrive,
  onStop,
  onClear,
  onSaveOffline,
  offlineBusy,
  offlineError,
  isCruiseMode,
  getShareUrl,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [destination, setDestination] = useState<StopDraft>(EMPTY_DRAFT);
  const [vias, setVias] = useState<StopDraft[]>([]);
  const [copied, setCopied] = useState(false);
  const status = useTripSelector((s) => s.status);
  const route = useTripSelector((s) => s.route);
  const error = useTripSelector((s) => s.error);
  const progress = useTripSelector((s) => s.progress);
  const summary = useTripSelector((s) => s.summary);
  const resnaps = useTripSelector((s) => s.resnaps);
  const upcoming = useTripSelector(nextStep);
  const tripStops = useTripSelector((s) => s.stops);

  useFocusTrap(panelRef, isOpen);
  if (!isOpen) return null;

  const origin = getOrigin();
  const ready = Boolean(origin && destination.stop && vias.every((v) => v.stop));
  const plan = (): void => {
    if (!origin || !destination.stop) return;
    onPlan([
      { ...origin, label: 'Current location' },
      ...vias.map((v) => v.stop!),
      destination.stop,
    ]);
  };
  const share = async (): Promise<void> => {
    const url = getShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this trip link', url);
    }
  };
  const offlineLookups = route ? Math.ceil(route.lengthM / TRIP_OFFLINE_SPACING_M) + 1 : 0;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trip-panel-title"
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onWheel={stop}
      onContextMenu={stop}
      onKeyUp={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      style={{
        position: 'absolute', top: 80, right: 20, width: 380, maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', backgroundColor: 'rgba(30, 30, 30, 0.95)',
        borderRadius: 12, border: '1px solid #444', zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        color: '#fff', fontSize: 13,
      }}
    >
      <div style={{
        padding: 15, borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)',
      }}>
        <h2 id="trip-panel-title" style={{ margin: 0, fontSize: 16 }}>🧭 Trip planner</h2>
        <button
          onClick={onClose}
          aria-label="Close trip planner"
          style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: 15 }}>
        {!routing.endpoint && (
          <p role="status" style={{ color: '#f0ad4e', marginTop: 0 }}>
            Routing is switched off on this deployment (no ROUTING_ENDPOINT in config.js).
          </p>
        )}
        {routing.usingDemo && (
          <p style={{ color: '#aaa', marginTop: 0, fontSize: 12 }}>
            Routes come from the public OSRM demo server — fine for trying this out, not for heavy use.
          </p>
        )}

        <div style={{ color: '#aaa', fontSize: 12, marginBottom: 10 }}>
          From: current location{origin ? ` (${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)})` : ' — waiting for Street View'}
        </div>

        {vias.map((v, i) => (
          <StopField
            key={i}
            label={`Via ${i + 1}`}
            draft={v}
            onChange={(next) => setVias((prev) => prev.map((p, j) => (j === i ? next : p)))}
            onRemove={() => setVias((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
        <StopField label="Destination" draft={destination} onChange={setDestination} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" onClick={plan} disabled={!ready || !routing.endpoint || status === 'planning'} style={btn('#2e7d32', !ready || !routing.endpoint || status === 'planning')}>
            {status === 'planning' ? 'Planning…' : 'Plan route'}
          </button>
          <button
            type="button"
            onClick={() => setVias((prev) => [...prev, EMPTY_DRAFT])}
            disabled={vias.length >= MAX_VIA_POINTS}
            style={btn('rgba(255,255,255,0.12)', vias.length >= MAX_VIA_POINTS)}
          >
            + Via point
          </button>
        </div>

        {status === 'error' && error && (
          <p role="alert" style={{ color: '#ff6b6b', margin: '0 0 12px' }}>{error}</p>
        )}

        {route && (status === 'ready' || status === 'driving') && (
          <section aria-label="Route" style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              {formatGuidanceDistance(route.distanceM || route.lengthM)} · {formatEta(route.durationS)} by road
            </div>
            <div style={{ color: '#aaa', fontSize: 12, marginBottom: 10 }}>
              {route.steps.length} steps · cruise drives it at Street View pace
            </div>

            {status === 'driving' && progress && (
              <div aria-live="polite" style={{ background: 'rgba(255,255,255,0.06)', padding: 10, borderRadius: 8, marginBottom: 10 }}>
                {upcoming && (
                  <div style={{ fontWeight: 600 }}>
                    In {formatGuidanceDistance(progress.distanceToNextStepM)}: {maneuverInstruction(upcoming.maneuver, upcoming.name, upcoming.exit)}
                  </div>
                )}
                <div style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>
                  {formatGuidanceDistance(progress.remainingM)} to go · ETA {formatEta(progress.etaS)}
                  {resnaps > 0 ? ` · ${resnaps} re-snap${resnaps === 1 ? '' : 's'}` : ''}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {status === 'driving' && isCruiseMode ? (
                <button type="button" onClick={onStop} style={btn('#c62828')}>Stop</button>
              ) : (
                <button type="button" onClick={onDrive} style={btn('#1565c0')}>
                  {status === 'driving' ? 'Resume' : 'Drive'}
                </button>
              )}
              <button type="button" onClick={() => void share()} style={btn('rgba(255,255,255,0.12)')}>
                {copied ? 'Link copied' : 'Share link'}
              </button>
              <button
                type="button"
                onClick={onSaveOffline}
                disabled={offlineBusy}
                title={`Prefetches the Street View link graph along the route: about ${offlineLookups} pano lookups, counted on the session call meter.`}
                style={btn('rgba(255,255,255,0.12)', offlineBusy)}
              >
                {offlineBusy ? 'Saving…' : 'Save for offline'}
              </button>
              <button
                type="button"
                onClick={() => downloadTextFile(routeToGpx(route, tripStops), 'road-trip.gpx', 'application/gpx+xml')}
                style={btn('rgba(255,255,255,0.12)')}
              >
                GPX
              </button>
              <button type="button" onClick={onClear} style={btn('rgba(255,255,255,0.12)')}>Clear</button>
            </div>
            {offlineError && <p role="alert" style={{ color: '#ff6b6b', fontSize: 12 }}>{offlineError}</p>}
          </section>
        )}

        {status === 'arrived' && summary && (
          <section aria-label="Trip summary" style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>🏁 You have arrived</div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: '0 0 10px' }}>
              <dt style={{ color: '#aaa' }}>Road distance</dt><dd style={{ margin: 0 }}>{formatGuidanceDistance(summary.distanceM)}</dd>
              <dt style={{ color: '#aaa' }}>Time</dt><dd style={{ margin: 0 }}>{formatEta(summary.elapsedS)}</dd>
              <dt style={{ color: '#aaa' }}>Average</dt>
              <dd style={{ margin: 0 }}>{summary.avgSpeedMps === null ? '—' : `${(summary.avgSpeedMps * 3.6).toFixed(1)} km/h`}</dd>
              <dt style={{ color: '#aaa' }}>Re-snaps</dt><dd style={{ margin: 0 }}>{summary.resnaps}</dd>
            </dl>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void share()} style={btn('rgba(255,255,255,0.12)')}>
                {copied ? 'Link copied' : 'Share link'}
              </button>
              <button type="button" onClick={onClear} style={btn('rgba(255,255,255,0.12)')}>New trip</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default TripPlannerPanel;
