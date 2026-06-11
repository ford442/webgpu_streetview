import React from 'react';

export interface AppBannersProps {
  showMissingKeyBanner: boolean;
  setShowMissingKeyBanner: (v: boolean) => void;
  showAuthFailedBanner: boolean;
  setShowAuthFailedBanner: (v: boolean) => void;
}

const AppBanners: React.FC<AppBannersProps> = ({
  showMissingKeyBanner,
  setShowMissingKeyBanner,
  showAuthFailedBanner,
  setShowAuthFailedBanner,
}) => {
  const currentHost =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'this host';

  return (
    <>
      {/* Missing API key banner */}
      {showMissingKeyBanner && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
            background: 'rgba(180,100,0,0.95)', color: '#fff',
            padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
            fontFamily: 'system-ui, sans-serif', fontSize: 14,
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
        >
          <span style={{ flex: 1 }}>
            ⚠️ <strong>No Google Maps API key is configured.</strong>{' '}
            Street View will not load until you build with <code>REACT_APP_MAPS_API_KEY</code> in <code>.env.local</code> or deploy with <code>MAPS_API_KEY=... python deploy.py</code> (bakes the key into <code>main.js</code>, same as go.1ink.us).
          </span>
          <button
            onClick={() => setShowMissingKeyBanner(false)}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.6)', color: '#fff', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: 13 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Maps API auth-failure banner — prominent and diagnostic */}
      {showAuthFailedBanner && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: showMissingKeyBanner ? 44 : 0, left: 0, right: 0, zIndex: 2000,
            background: 'rgba(180,0,0,0.97)', color: '#fff',
            padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12,
            fontFamily: 'system-ui, sans-serif', fontSize: 14, lineHeight: 1.35,
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
        >
          <div style={{ flex: 1 }}>
            🔑 <strong>Google Maps API authentication failed on {currentHost}.</strong><br />
            The key is either referrer-restricted to other domains (e.g. go.1ink.us works but test.1ink.us does not), billing is disabled on the GCP project, or the Maps JavaScript + Directions APIs are not enabled for the key.
            <span style={{ opacity: 0.9 }}> Cruise mode paused. Street View may show Google’s error overlay until a valid key for this origin is deployed.</span>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
              Fix: In Google Cloud Console, add <code>{`https://${currentHost}/*`}</code> to the key’s HTTP referrer allowlist (also include <code>https://test.1ink.us/*</code> and <code>https://go.1ink.us/*</code> if you use both), ensure billing is linked, then re-deploy with <code>MAPS_API_KEY=... python deploy.py</code> and verify <code>{`https://${currentHost}/streetview/config.js`}</code> returns your key.
            </div>
          </div>
          <button
            onClick={() => setShowAuthFailedBanner(false)}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.6)', color: '#fff', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: 13, flexShrink: 0, marginTop: 2 }}
            title="Dismiss (error may still affect the map)"
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
};

export default AppBanners;
