interface MapsAuthModalProps {
  open: boolean;
  mapsAuthError: string | null;
  isRetryingMapsAuth: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

/** Full-screen Maps API key / referrer auth failure dialog. */
export function MapsAuthModal({
  open,
  mapsAuthError,
  isRetryingMapsAuth,
  onRetry,
  onDismiss,
}: MapsAuthModalProps) {
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maps-auth-error-title"
      aria-describedby="maps-auth-error-description"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          background: 'linear-gradient(145deg, rgba(32,12,12,0.98), rgba(10,10,10,0.98))',
          border: '1px solid rgba(255,120,120,0.55)',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          padding: 28,
        }}
      >
        <div
          style={{
            fontSize: 13,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#ffb3b3',
            marginBottom: 10,
          }}
        >
          Maps authentication failed
        </div>
        <h2 id="maps-auth-error-title" style={{ margin: '0 0 12px', fontSize: 28, lineHeight: 1.1 }}>
          Google Maps API key error
        </h2>
        <p
          id="maps-auth-error-description"
          style={{ margin: '0 0 16px', lineHeight: 1.5, color: 'rgba(255,255,255,0.88)' }}
        >
          {mapsAuthError ||
            'Google Maps API key error — check referrer restrictions and billing in Google Cloud Console.'}
        </p>
        <div
          style={{
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 10,
            padding: 12,
            fontSize: 13,
            lineHeight: 1.45,
            marginBottom: 20,
          }}
        >
          Verify that this host is whitelisted under HTTP referrer restrictions, billing is enabled, and the Maps
          JavaScript API plus Street View dependencies are enabled for the key.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={onRetry}
            disabled={isRetryingMapsAuth}
            style={{
              background: isRetryingMapsAuth ? 'rgba(255,255,255,0.22)' : '#ff6b6b',
              border: 0,
              borderRadius: 8,
              color: '#fff',
              cursor: isRetryingMapsAuth ? 'wait' : 'pointer',
              fontWeight: 700,
              padding: '10px 16px',
            }}
          >
            {isRetryingMapsAuth ? 'Retrying…' : 'Retry Maps'}
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.5)',
              borderRadius: 8,
              color: '#fff',
              cursor: 'pointer',
              padding: '10px 16px',
            }}
          >
            Reload page
          </button>
          <button
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              padding: '10px 16px',
              fontSize: '13px',
            }}
            title="Clear error overlay (use if key was fixed externally; canvas may now load)"
          >
            Dismiss block
          </button>
        </div>
      </div>
    </div>
  );
}
