import React, { useMemo } from 'react';
import { formatImageDate, yearStripLabels, type HistoricalPanoEntry } from '../utils/historicalImagery';

export interface HistoricalTimelineProps {
  isOpen: boolean;
  onClose: () => void;
  entries: HistoricalPanoEntry[];
  isLoading: boolean;
  error: string | null;
  hasTimeline: boolean;
  currentIndex: number;
  /** Disabled while a hold-pause hop is already in flight. */
  isTransitioning: boolean;
  onSelectDate: (entry: HistoricalPanoEntry) => void;
  /** Compare-mode support (optional — panel still works as a plain scrubber without it). */
  onCompare?: (entry: HistoricalPanoEntry) => void;
  isComparing?: boolean;
  onExitCompare?: () => void;
  /** What the compare stills hold — road only, or road + cabin (`compareStillScopeLabel`). */
  compareScopeLabel?: string;
}

const HistoricalTimeline: React.FC<HistoricalTimelineProps> = ({
  isOpen,
  onClose,
  entries,
  isLoading,
  error,
  hasTimeline,
  currentIndex,
  isTransitioning,
  onSelectDate,
  onCompare,
  isComparing = false,
  onExitCompare,
  compareScopeLabel = 'Compare stills show the road view only (no cabin).',
}) => {
  const labels = useMemo(() => yearStripLabels(entries), [entries]);
  const onScreen = currentIndex >= 0 ? currentIndex : entries.length - 1;
  const activeEntry = entries[onScreen] ?? null;

  if (!isOpen) return null;

  // Selecting a year is a hold-pause hop via onSelectDate (teleportToPanoSafe);
  // the strip never touches the Maps canvas itself.
  const handleSelect = (index: number) => {
    const entry = entries[index];
    if (!entry || isTransitioning || index === currentIndex) return;
    onSelectDate(entry);
  };

  const handleStripKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = at < 0 ? onScreen : at + (e.key === 'ArrowRight' ? 1 : -1);
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    border: `1px solid ${active ? '#4FC3F7' : '#3a5068'}`,
    borderRadius: '999px',
    backgroundColor: active ? 'rgba(79,195,247,0.25)' : 'rgba(0,0,0,0.4)',
    color: active ? '#4FC3F7' : '#ccc',
    cursor: active || isTransitioning ? 'default' : 'pointer',
    fontSize: '12px',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    opacity: isTransitioning && !active ? 0.5 : 1,
  });

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        width: 'min(560px, calc(100vw - 40px))',
        backgroundColor: 'rgba(20, 28, 38, 0.96)',
        borderRadius: '12px',
        border: '1px solid #2a4a6a',
        zIndex: 100,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #2a4a6a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ margin: 0, color: '#4FC3F7', fontSize: '14px', letterSpacing: '0.5px' }}>
          🕰️ Historical Imagery
        </h3>
        <button
          onClick={onClose}
          aria-label="Close historical timeline"
          style={{
            background: 'none',
            border: 'none',
            color: '#aaa',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '0 5px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {isLoading && (
          <div style={{ color: '#aaa', fontSize: '12px', marginBottom: 10 }}>
            Scanning nearby imagery…
          </div>
        )}

        {error && (
          <div style={{ color: '#ff8a80', fontSize: '12px', marginBottom: 10 }}>
            {error}
          </div>
        )}

        {!isLoading && !error && !hasTimeline && (
          <div style={{ color: '#ccc', fontSize: '12px', lineHeight: 1.5 }} data-testid="historical-empty">
            {entries.length === 1
              ? `Google only published one capture here (${formatImageDate(entries[0]!.imageDate)}). There is no older imagery to travel to from this spot.`
              : 'Google has no Street View capture dates near this spot.'}
          </div>
        )}

        {hasTimeline && (
          <>
            <div
              role="group"
              aria-label="Capture years"
              onKeyDown={handleStripKey}
              style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}
            >
              {entries.map((entry, i) => {
                const active = i === onScreen;
                return (
                  <button
                    key={entry.panoId}
                    type="button"
                    aria-pressed={active}
                    aria-label={`Travel to ${formatImageDate(entry.imageDate)}`}
                    disabled={isTransitioning && !active}
                    onClick={() => handleSelect(i)}
                    style={chipStyle(active)}
                  >
                    {labels[i]}
                  </button>
                );
              })}
            </div>

            {onCompare && (
              <div style={{ marginTop: 12 }}>
                {isComparing ? (
                  <button type="button" onClick={() => onExitCompare?.()} style={chipStyle(true)}>
                    Exit compare
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#888', fontSize: '11px' }}>⇄ Compare now with</span>
                    {entries.map((entry, i) =>
                      i === onScreen ? null : (
                        <button
                          key={entry.panoId}
                          type="button"
                          disabled={isTransitioning}
                          onClick={() => onCompare(entry)}
                          aria-label={`Compare with ${formatImageDate(entry.imageDate)}`}
                          style={chipStyle(false)}
                        >
                          {labels[i]}
                        </button>
                      ),
                    )}
                  </div>
                )}
                <div style={{ marginTop: 6, color: '#777', fontSize: '10px' }}>
                  {compareScopeLabel}
                </div>
              </div>
            )}
          </>
        )}

        {/* Attribution — required by Google's Street View ToS whenever imagery is displayed */}
        {activeEntry && (
          <div style={{ marginTop: 12, color: '#666', fontSize: '10px' }}>
            {activeEntry.copyright || '© Google'}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoricalTimeline;
