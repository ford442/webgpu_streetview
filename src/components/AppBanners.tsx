import React from 'react';

export interface AppBannersProps {
  showMissingKeyBanner: boolean;
  setShowMissingKeyBanner: (v: boolean) => void;
  showAuthFailedBanner: boolean;
  setShowAuthFailedBanner: (v: boolean) => void;
  isRecoveringMapsAuth?: boolean;
  /** Mid-session canvas scrape loss (distinct from Maps auth failure). */
  scrapeLost?: boolean;
  scrapeLostDetail?: string | null;
}

const AppBanners: React.FC<AppBannersProps> = ({
  showMissingKeyBanner,
  setShowMissingKeyBanner,
  showAuthFailedBanner,
  setShowAuthFailedBanner,
  isRecoveringMapsAuth = false,
  scrapeLost = false,
  scrapeLostDetail = null,
}) => {
  const currentHost =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'this host';

  const topOffset =
    (showMissingKeyBanner ? 44 : 0) +
    (isRecoveringMapsAuth || (showAuthFailedBanner && !isRecoveringMapsAuth) ? 48 : 0);

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

      {isRecoveringMapsAuth && (
        <div
          role="status"
          style={{
            position: 'fixed', top: showMissingKeyBanner ? 44 : 0, left: 0, right: 0, zIndex: 2000,
            background: 'rgba(26,92,120,0.96)', color: '#fff',
            padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
            fontFamily: 'system-ui, sans-serif', fontSize: 14,
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
        >
          <span style={{ flex: 1 }}>
            <strong>Retrying with new Maps key...</strong> Street View will resume automatically when the API and panorama canvas are ready.
          </span>
        </div>
      )}

      {/* Maps API auth-failure banner — prominent and diagnostic */}
      {showAuthFailedBanner && !isRecoveringMapsAuth && (
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

      {/* Mid-session scrape loss — distinct from auth / key failure */}
      {scrapeLost && !showAuthFailedBanner && !isRecoveringMapsAuth && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: topOffset || (showMissingKeyBanner ? 44 : 0),
            left: 0,
            right: 0,
            zIndex: 1990,
            background: 'rgba(90,70,20,0.96)',
            color: '#fff',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
        >
          <span style={{ flex: 1 }}>
            <strong>Street View canvas scrape interrupted.</strong>{' '}
            {scrapeLostDetail ||
              'Google may have replaced the panorama canvas — reconnecting automatically.'}{' '}
            This is not an API key error. Check <code>window.__STREETVIEW_PROBE__.getScraperHealth()</code> for details.
          </span>
        </div>
      )}
    </>
  );
};

export default AppBanners;
