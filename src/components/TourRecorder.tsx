import React, { useState } from 'react';
import { TourWaypoint } from '../hooks/useTours';

interface TourRecorderProps {
    isRecording: boolean;
    isPaused: boolean;
    draftWaypoints: TourWaypoint[];
    currentLocationLabel?: string;
    onStart: (name: string) => void;
    onPause: () => void;
    onResume: () => void;
    onStop: (name: string) => void;
    onCancel: () => void;
    onAddWaypoint: (dwellTimeMs: number, annotation?: string) => void;
}

const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
};

const TourRecorder: React.FC<TourRecorderProps> = ({
    isRecording,
    isPaused,
    draftWaypoints,
    currentLocationLabel,
    onStart,
    onPause,
    onResume,
    onStop,
    onCancel,
    onAddWaypoint,
}) => {
    const [tourName, setTourName] = useState('');
    const [dwellSeconds, setDwellSeconds] = useState(4);
    const [annotation, setAnnotation] = useState('');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {!isRecording ? (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onStart(tourName.trim() || `Tour ${new Date().toLocaleDateString()}`);
                    }}
                    style={{ display: 'flex', gap: '8px' }}
                >
                    <input
                        type="text"
                        placeholder="Tour name..."
                        value={tourName}
                        onChange={(e) => setTourName(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        aria-label="New tour name"
                        style={{
                            flex: 1,
                            padding: '8px 12px',
                            border: '1px solid #555',
                            borderRadius: '4px',
                            backgroundColor: '#333',
                            color: '#fff',
                            fontSize: '14px',
                        }}
                    />
                    <button type="submit" style={{ ...btnStyle, backgroundColor: '#4CAF50' }} aria-label="Start recording tour">
                        ● Record
                    </button>
                </form>
            ) : (
                <>
                    <div style={{ color: '#ccc', fontSize: '13px' }}>
                        {isPaused ? '⏸ Paused' : '● Recording'} — {draftWaypoints.length} waypoint{draftWaypoints.length === 1 ? '' : 's'}
                        {currentLocationLabel ? ` · ${currentLocationLabel}` : ''}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ color: '#aaa', fontSize: '12px' }}>
                            Dwell (s):
                            <input
                                type="number"
                                min={1}
                                max={60}
                                value={dwellSeconds}
                                onChange={(e) => setDwellSeconds(Math.max(1, Number(e.target.value) || 1))}
                                onKeyDown={(e) => e.stopPropagation()}
                                style={{ width: '54px', marginLeft: '6px', padding: '4px', backgroundColor: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                            />
                        </label>
                        <input
                            type="text"
                            placeholder="Annotation (optional)..."
                            value={annotation}
                            onChange={(e) => setAnnotation(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            aria-label="Waypoint annotation"
                            style={{ flex: 1, minWidth: '120px', padding: '6px 10px', border: '1px solid #555', borderRadius: '4px', backgroundColor: '#333', color: '#fff', fontSize: '13px' }}
                        />
                        <button
                            style={{ ...btnStyle, backgroundColor: '#2196F3' }}
                            onClick={() => { onAddWaypoint(dwellSeconds * 1000, annotation.trim() || undefined); setAnnotation(''); }}
                            aria-label="Add waypoint at current view"
                        >
                            + Waypoint
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        {isPaused ? (
                            <button style={{ ...btnStyle, backgroundColor: '#4CAF50' }} onClick={onResume} aria-label="Resume recording">
                                ▶ Resume
                            </button>
                        ) : (
                            <button style={{ ...btnStyle, backgroundColor: '#f0ad4e' }} onClick={onPause} aria-label="Pause recording">
                                ⏸ Pause
                            </button>
                        )}
                        <button
                            style={{ ...btnStyle, backgroundColor: '#d9534f' }}
                            onClick={() => onStop(tourName.trim() || `Tour ${new Date().toLocaleDateString()}`)}
                            disabled={draftWaypoints.length === 0}
                            aria-label="Stop and save tour"
                        >
                            ■ Stop &amp; Save
                        </button>
                        <button style={{ ...btnStyle, backgroundColor: '#555' }} onClick={onCancel} aria-label="Cancel recording">
                            ✕ Cancel
                        </button>
                    </div>

                    {draftWaypoints.length > 0 && (
                        <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #333', borderRadius: '6px' }}>
                            {draftWaypoints.map((wp, i) => (
                                <div key={wp.id} style={{ padding: '6px 10px', borderBottom: '1px solid #333', fontSize: '12px', color: '#ccc', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{i + 1}. {wp.position.lat.toFixed(4)}, {wp.position.lng.toFixed(4)}</span>
                                    <span style={{ color: '#888' }}>{(wp.dwellTimeMs / 1000).toFixed(0)}s{wp.annotation ? ` · ${wp.annotation}` : ''}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default TourRecorder;
