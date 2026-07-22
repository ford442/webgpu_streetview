interface OfflineStatusToastProps {
  visible: boolean;
}

/** Fixed toast when the app is connected but the browser is offline. */
export function OfflineStatusToast({ visible }: OfflineStatusToastProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2400,
        background: 'rgba(255,152,0,0.92)',
        color: '#111',
        padding: '8px 16px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      Offline — saved snapshots, bookmarks, and tours remain available
    </div>
  );
}
