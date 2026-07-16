import React, { useMemo, useState } from 'react';
import { formatImageDate, type HistoricalPanoEntry } from '../utils/historicalImagery';

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
}) => {
  const [sliderIndex, setSliderIndex] = useState<number | null>(null);

  const activeIndex = sliderIndex ?? (currentIndex >= 0 ? currentIndex : entries.length - 1);
  const activeEntry = entries[activeIndex] ?? null;

  const trackDots = useMemo(
    () => entries.map((e, i) => ({ entry: e, index: i })),
    [entries]
  );

  if (!isOpen) return null;

  const handleSlide = (index: number) => {
    setSliderIndex(index);
  };

  const handleCommit = (index: number) => {
    const entry = entries[index];
    if (!entry || entry.panoId === entries[currentIndex]?.panoId) return;
    onSelectDate(entry);
  };

  const dotStyle = (active: boolean): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: active ? '#4FC3F7' : 'rgba(255,255,255,0.35)',
    flexShrink: 0,
  });

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
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
          <div style={{ color: '#ccc', fontSize: '12px', lineHeight: 1.5 }}>
            {entries.length === 1
              ? `Only one capture date (${formatImageDate(entries[0]!.imageDate)}) is available near this location.`
              : 'No historical imagery found near this location.'}
          </div>
        )}

        {hasTimeline && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 8,
              }}
            >
              <span style={{ color: '#fff', fontSize: '18px', fontWeight: 700 }}>
                {activeEntry ? formatImageDate(activeEntry.imageDate) : ''}
              </span>
              <span style={{ color: '#777', fontSize: '11px' }}>
                {activeIndex + 1} / {entries.length}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={entries.length - 1}
              step={1}
              value={activeIndex}
              disabled={isTransitioning}
              onChange={(e) => handleSlide(parseInt(e.target.value, 10))}
              onMouseUp={(e) => handleCommit(parseInt((e.target as HTMLInputElement).value, 10))}
              onTouchEnd={(e) => handleCommit(parseInt((e.target as HTMLInputElement).value, 10))}
              onKeyUp={(e) => handleCommit(parseInt((e.target as HTMLInputElement).value, 10))}
              style={{ width: '100%', accentColor: '#4FC3F7', opacity: isTransitioning ? 0.5 : 1 }}
              aria-label="Scrub through available capture dates"
            />

            {/* Density dots along the track */}
            <div style={{ display: 'flex', gap: 4, marginTop: 4, marginBottom: 12 }}>
              {trackDots.map(({ index }) => (
                <div key={index} style={dotStyle(index === activeIndex)} />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {onCompare && (
                <button
                  onClick={() =>
                    isComparing ? onExitCompare?.() : activeEntry && onCompare(activeEntry)
                  }
                  disabled={isTransitioning || !activeEntry || activeIndex === currentIndex}
                  style={{
                    padding: '6px 12px',
                    border: `1px solid ${isComparing ? '#4FC3F7' : '#555'}`,
                    borderRadius: '4px',
                    backgroundColor: isComparing ? 'rgba(79,195,247,0.25)' : 'rgba(0,0,0,0.5)',
                    color: isComparing ? '#4FC3F7' : '#ccc',
                    cursor: (isTransitioning || !activeEntry) ? 'default' : 'pointer',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    opacity: (isTransitioning || !activeEntry || activeIndex === currentIndex) ? 0.5 : 1,
                  }}
                >
                  {isComparing ? 'Exit compare' : '⇄ Compare with current'}
                </button>
              )}
            </div>
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
