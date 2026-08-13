/**
 * ScoutCard.tsx
 *
 * Standalone hover/click preview card for the Globe View.
 * Shows a Street View Static API thumbnail, coordinates, and an "Engage" button
 * that triggers an Orbital Drop teleportation.
 */

import React, { useCallback } from 'react';

export interface ScoutCardProps {
    lat: number;
    lng: number;
    label?: string;
    mapsApiKey: string;
    onEngage: (lat: number, lng: number) => void;
    onClose: () => void;
    /** When omitted, skip Street View Static (billable) and show coords only. */
    thumbnailUrl?: string | null;
}

const ScoutCard: React.FC<ScoutCardProps> = ({
    lat,
    lng,
    label,
    mapsApiKey,
    onEngage,
    onClose,
    thumbnailUrl: thumbnailUrlProp,
}) => {
    const thumbnailUrl =
        thumbnailUrlProp === null
            ? undefined
            : thumbnailUrlProp ??
              (mapsApiKey
                  ? `https://maps.googleapis.com/maps/api/streetview?size=300x200&location=${lat},${lng}&key=${mapsApiKey}`
                  : undefined);

    const handleEngage = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onEngage(lat, lng);
        },
        [lat, lng, onEngage]
    );

    const handleClose = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onClose();
        },
        [onClose]
    );

    // Block propagation on all events so globe doesn't react
    const stopProp = useCallback((e: React.SyntheticEvent) => {
        e.stopPropagation();
    }, []);

    return (
        <div
            role="dialog"
            aria-label="Location preview"
            onClick={stopProp}
            onMouseDown={stopProp}
            onMouseUp={stopProp}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') onClose();
            }}
            style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 210,
                width: 320,
                backgroundColor: 'rgba(15, 15, 20, 0.95)',
                borderRadius: 12,
                border: '1px solid rgba(0,204,255,0.5)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 20px rgba(0,204,255,0.15)',
                overflow: 'hidden',
                fontFamily: 'system-ui, sans-serif',
                color: '#fff',
            }}
        >
            {/* Thumbnail */}
            <div style={{ position: 'relative', width: '100%', height: 200, backgroundColor: '#111' }}>
                {thumbnailUrl ? (
                <img
                    src={thumbnailUrl}
                    alt={`Street View preview at ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />
                ) : (
                <div style={{ color: '#888', fontSize: 13, padding: 16 }}>Preview unavailable</div>
                )}
                {/* Close button */}
                <button
                    onClick={handleClose}
                    aria-label="Close scout card"
                    style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.3)',
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    ✕
                </button>
            </div>

            {/* Info section */}
            <div style={{ padding: '12px 16px' }}>
                {label && (
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                        {label}
                    </div>
                )}
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
                    📍 {lat.toFixed(5)}, {lng.toFixed(5)}
                </div>

                {/* Engage button */}
                <button
                    onClick={handleEngage}
                    style={{
                        width: '100%',
                        padding: '10px 0',
                        backgroundColor: 'rgba(0,204,255,0.2)',
                        border: '1px solid rgba(0,204,255,0.5)',
                        borderRadius: 8,
                        color: '#00CCFF',
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        letterSpacing: '0.5px',
                    }}
                    onMouseEnter={(e) => {
                        (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,204,255,0.35)';
                    }}
                    onMouseLeave={(e) => {
                        (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,204,255,0.2)';
                    }}
                >
                    🚀 Engage Orbital Drop
                </button>
            </div>
        </div>
    );
};

export default ScoutCard;
