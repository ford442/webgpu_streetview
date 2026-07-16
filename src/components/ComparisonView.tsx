import React, { useCallback, useRef, useState } from 'react';
import { formatImageDate, type HistoricalPanoEntry } from '../utils/historicalImagery';

export interface ComparisonViewProps {
  beforeUrl: string;
  afterUrl: string;
  beforeEntry: HistoricalPanoEntry;
  afterLabel: string;
  onClose: () => void;
}

/**
 * Before/after swipe overlay over two already-captured canvas snapshots.
 * Both snapshots share the heading/pitch they were captured at (teleportToPano
 * never touches POV), so the comparison is POV-matched without needing a
 * second live-linked render context.
 */
const ComparisonView: React.FC<ComparisonViewProps> = ({
  beforeUrl,
  afterUrl,
  beforeEntry,
  afterLabel,
  onClose,
}) => {
  const [splitPercent, setSplitPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.max(0, Math.min(100, pct)));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Before and after comparison"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 200,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'hidden',
          cursor: 'ew-resize',
          touchAction: 'none',
        }}
      >
        {/* After (current) — full width base layer */}
        <img
          src={afterUrl}
          alt={`Current view (${afterLabel})`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          draggable={false}
        />

        {/* Before (historical) — clipped to the split position */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${splitPercent}%`,
            overflow: 'hidden',
          }}
        >
          <img
            src={beforeUrl}
            alt={`Historical view (${formatImageDate(beforeEntry.imageDate)})`}
            style={{
              position: 'absolute',
              inset: 0,
              width: containerRef.current ? containerRef.current.clientWidth : '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            draggable={false}
          />
        </div>

        {/* Divider handle */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${splitPercent}%`,
            width: 2,
            backgroundColor: '#4FC3F7',
            transform: 'translateX(-1px)',
            pointerEvents: 'none',
            boxShadow: '0 0 8px rgba(79,195,247,0.8)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${splitPercent}%`,
            transform: 'translate(-50%, -50%)',
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: '#4FC3F7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000',
            fontSize: 14,
            fontWeight: 700,
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          ⇄
        </div>

        {/* Date labels */}
        <div style={{ position: 'absolute', top: 16, left: 16, ...labelStyle }}>
          {formatImageDate(beforeEntry.imageDate)}
        </div>
        <div style={{ position: 'absolute', top: 16, right: 16, ...labelStyle }}>
          {afterLabel}
        </div>
      </div>

      <div
        style={{
          padding: '10px 16px',
          backgroundColor: 'rgba(20, 28, 38, 0.96)',
          borderTop: '1px solid #2a4a6a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'monospace',
        }}
      >
        <span style={{ color: '#666', fontSize: '10px' }}>
          {beforeEntry.copyright || '© Google'} — drag to compare
        </span>
        <button
          onClick={onClose}
          style={{
            padding: '6px 14px',
            border: '1px solid #555',
            borderRadius: '4px',
            backgroundColor: 'rgba(0,0,0,0.5)',
            color: '#ccc',
            cursor: 'pointer',
            fontSize: '11px',
            fontFamily: 'monospace',
          }}
        >
          Close comparison
        </button>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  backgroundColor: 'rgba(0,0,0,0.6)',
  color: '#fff',
  fontSize: 12,
  fontFamily: 'monospace',
  fontWeight: 700,
};

export default ComparisonView;
