import React, { useEffect, useState, useCallback } from 'react';
import { useFocusTrap } from '../hooks/useKeyboardShortcuts';
import {
  clearAllOfflineData,
  clearOfflineCaches,
  readStorageEstimate,
  requestPersistentStorage,
  type StorageEstimateSummary,
  type RouteGraphSummary,
} from '../offline';

interface StorageManagementPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isOnline: boolean;
  hasServiceWorker: boolean;
  /** Offline route-graph prefetch (Phase 3) — optional so panel still works without it wired up. */
  routeGraphSummaries?: RouteGraphSummary[];
  onDeleteRouteGraph?: (routeId: string) => void;
  onRefreshRouteGraphs?: () => void;
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'min(520px, 92vw)',
  maxHeight: '85vh',
  overflowY: 'auto',
  background: 'rgba(12,12,12,0.96)',
  border: '1px solid rgba(76,175,80,0.45)',
  borderRadius: 14,
  padding: 24,
  zIndex: 1200,
  color: '#fff',
  fontFamily: 'system-ui, sans-serif',
  boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
};

const StorageManagementPanel: React.FC<StorageManagementPanelProps> = ({
  isOpen,
  onClose,
  isOnline,
  hasServiceWorker,
  routeGraphSummaries = [],
  onDeleteRouteGraph,
  onRefreshRouteGraphs,
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [estimate, setEstimate] = useState<StorageEstimateSummary | null>(null);
  const [busy, setBusy] = useState<'cache' | 'all' | 'persist' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useFocusTrap(panelRef, isOpen);

  const refresh = useCallback(async () => {
    setEstimate(await readStorageEstimate());
    onRefreshRouteGraphs?.();
  }, [onRefreshRouteGraphs]);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, refresh]);

  if (!isOpen) return null;

  const handleClearCache = async () => {
    if (!window.confirm('Clear cached app shell, shaders, and WASM? You will need internet to reload them.')) {
      return;
    }
    setBusy('cache');
    setMessage(null);
    try {
      const result = await clearOfflineCaches();
      setMessage(`Cleared ${result.deletedCacheNames.length} cache(s).`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear cache.');
    } finally {
      setBusy(null);
    }
  };

  const handleClearAll = async () => {
    if (
      !window.confirm(
        'Clear ALL offline data (cache + IndexedDB metadata + saved snapshots in local storage)? This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy('all');
    setMessage(null);
    try {
      await clearAllOfflineData();
      setMessage('All offline data cleared.');
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear offline data.');
    } finally {
      setBusy(null);
    }
  };

  const handlePersist = async () => {
    setBusy('persist');
    setMessage(null);
    try {
      const granted = await requestPersistentStorage();
      setMessage(granted ? 'Persistent storage granted.' : 'Persistent storage not granted by browser.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1199 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby="storage-panel-title"
        style={panelStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="storage-panel-title" style={{ margin: 0, fontSize: 22 }}>
            Offline Storage
          </h2>
          <button
            onClick={onClose}
            aria-label="Close storage panel"
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.35)',
              color: '#fff',
              borderRadius: 8,
              padding: '6px 10px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: isOnline ? 'rgba(76,175,80,0.2)' : 'rgba(255,152,0,0.25)',
              border: `1px solid ${isOnline ? 'rgba(76,175,80,0.5)' : 'rgba(255,152,0,0.5)'}`,
            }}
          >
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: hasServiceWorker ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            {hasServiceWorker ? 'Offline shell active' : 'Offline shell pending first visit'}
          </span>
        </div>

        <p style={{ margin: '0 0 12px', lineHeight: 1.5, color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
          Cached: app shell, WGSL shaders, WASM loader, and your saved snapshots, bookmarks, tours, and history
          metadata. Google Street View imagery is <strong>not</strong> cached (Maps Platform Terms).
        </p>

        {estimate && (
          <div
            style={{
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
              <span>Storage used</span>
              <span>
                {estimate.usageLabel} / {estimate.quotaLabel || 'unknown quota'}
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: 'rgba(255,255,255,0.12)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${estimate.percentUsed}%`,
                  height: '100%',
                  background: estimate.percentUsed > 85 ? '#ff6b6b' : '#4CAF50',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              {estimate.percentUsed.toFixed(1)}% of browser quota
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Prepared route graphs ({routeGraphSummaries.length})</h3>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
            Pano IDs and link connections for tours prepared via "Prepare offline graph" in the Tours panel.
            Imagery still requires a network connection — these store link IDs only, never tile pixels.
          </p>
          {routeGraphSummaries.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>None prepared yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {routeGraphSummaries.map((summary) => (
                <div
                  key={summary.routeId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: 13,
                  }}
                >
                  <span>{summary.nodeCount} pano{summary.nodeCount === 1 ? '' : 's'} cached</span>
                  {onDeleteRouteGraph && (
                    <button
                      onClick={() => onDeleteRouteGraph(summary.routeId)}
                      aria-label={`Delete route graph ${summary.routeId}`}
                      style={{ background: 'none', border: 'none', color: '#ff8a8a', cursor: 'pointer', fontSize: 12 }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => void handleClearCache()}
            disabled={busy !== null}
            style={actionButtonStyle}
          >
            {busy === 'cache' ? 'Clearing cache…' : 'Clear cached shell (shaders / WASM / JS)'}
          </button>
          <button
            onClick={() => void handleClearAll()}
            disabled={busy !== null}
            style={{ ...actionButtonStyle, borderColor: 'rgba(255,107,107,0.55)' }}
          >
            {busy === 'all' ? 'Clearing…' : 'Clear all offline data'}
          </button>
          <button
            onClick={() => void handlePersist()}
            disabled={busy !== null}
            style={actionButtonStyle}
          >
            {busy === 'persist' ? 'Requesting…' : 'Request persistent storage'}
          </button>
        </div>

        {message && (
          <p role="status" style={{ marginTop: 14, fontSize: 13, color: '#a5d6a7' }}>
            {message}
          </p>
        )}
      </div>
    </>
  );
};

const actionButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 8,
  color: '#fff',
  padding: '10px 12px',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 14,
};

export default StorageManagementPanel;
