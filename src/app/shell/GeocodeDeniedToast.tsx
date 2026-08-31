import { GEOCODE_DENIED_MESSAGE, useGeocodeDenied } from '../../search/geocodeAuth';

/** Non-blocking toast when Maps JS Geocoder returns REQUEST_DENIED. */
export function GeocodeDeniedToast() {
  const denied = useGeocodeDenied();
  if (!denied) return null;
  return (
    <div
      role="status"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2390,
        maxWidth: 'min(560px, calc(100vw - 24px))',
        background: 'rgba(255,152,0,0.94)',
        color: '#111',
        padding: '10px 16px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        lineHeight: 1.4,
      }}
    >
      {GEOCODE_DENIED_MESSAGE}
    </div>
  );
}
