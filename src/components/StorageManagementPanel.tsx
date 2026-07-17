import React, { useEffect, useState, useCallback } from 'react';
import { useFocusTrap } from '../hooks/useKeyboardShortcuts';
import {
  clearAllOfflineData,
  clearOfflineCaches,
  readStorageEstimate,
  requestPersistentStorage,
  type StorageEstimateSummary,
} from '../offline';

interface StorageManagementPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isOnline: boolean;
  hasServiceWorker: boolean;
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
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [estimate, setEstimate] = useState<StorageEstimateSummary | null>(null);
  const [busy, setBusy] = useState<'cache' | 'all' | 'persist' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useFocusTrap(panelRef, isOpen);

  const refresh = useCallback(async () => {
    setEstimate(await readStorageEstimate());
  }, []);

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
