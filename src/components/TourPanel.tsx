import React, { useRef, useEffect, useState } from 'react';
import { Tour, TourWaypoint, CurrentPOV, TourTransitionType } from '../hooks/useTours';
import { useFocusTrap } from '../hooks/useKeyboardShortcuts';
import TourRecorder from './TourRecorder';
import TourPlayer from './TourPlayer';

interface TourPanelProps {
    isOpen: boolean;
    onClose: () => void;

    tours: Tour[];
    isRecording: boolean;
    isPaused: boolean;
    draftWaypoints: TourWaypoint[];
    getCurrentPOV: () => CurrentPOV | null;
    currentLocationLabel?: string;
    onStartRecording: (name: string, getCurrentPOV: () => CurrentPOV | null) => void;
    onPauseRecording: () => void;
    onResumeRecording: () => void;
    onStopRecording: (name: string) => void;
    onCancelRecording: () => void;
    onAddWaypoint: (dwellTimeMs: number, annotation?: string) => void;

    onDeleteTour: (id: string) => void;
    onRenameTour: (id: string, name: string) => void;
    onUpdateTourSettings: (id: string, updates: Partial<Pick<Tour, 'transitionType' | 'autoPlaySpeed'>>) => void;
    onDownloadTourJson: (tour: Tour) => void;
    onDownloadTourKml: (tour: Tour) => void;
    onImportTourFromJson: (jsonText: string) => void;

    teleportToPano: (panoId: string) => Promise<void>;
    setHeading: (heading: number) => void;
    setPitch: (pitch: number) => void;
    setZoom: (zoom: number) => void;
    isPanoramaReady: boolean;
}

type TabKey = 'library' | 'record' | 'play';

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px',
    background: active ? '#4CAF50' : 'rgba(255,255,255,0.08)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 'bold',
});

const TourPanel: React.FC<TourPanelProps> = ({
    isOpen,
    onClose,
    tours,
    isRecording,
    isPaused,
    draftWaypoints,
    getCurrentPOV,
    currentLocationLabel,
    onStartRecording,
    onPauseRecording,
    onResumeRecording,
    onStopRecording,
    onCancelRecording,
    onAddWaypoint,
    onDeleteTour,
    onRenameTour,
    onUpdateTourSettings,
    onDownloadTourJson,
    onDownloadTourKml,
    onImportTourFromJson,
    teleportToPano,
    setHeading,
    setPitch,
    setZoom,
    isPanoramaReady,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [tab, setTab] = useState<TabKey>('library');
    const [selectedTourId, setSelectedTourId] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);

    useFocusTrap(panelRef, isOpen);

    useEffect(() => {
        if (!isOpen) return;
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const selectedTour = tours.find(t => t.id === selectedTourId) || null;

    const handleImportFile = (file: File) => {
        setImportError(null);
        file.text().then(text => {
            try {
                onImportTourFromJson(text);
            } catch (err) {
                setImportError(err instanceof Error ? err.message : 'Failed to import tour');
            }
        });
    };

    return (
        <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-panel-title"
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                top: '80px',
                right: '20px',
                width: '400px',
                maxHeight: 'calc(100vh - 120px)',
                backgroundColor: 'rgba(30, 30, 30, 0.95)',
                borderRadius: '12px',
                border: '1px solid #444',
                zIndex: 100,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
        >
            <div style={{
                padding: '15px',
                borderBottom: '1px solid #444',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'rgba(0,0,0,0.3)',
            }}>
                <h2 id="tour-panel-title" style={{ margin: 0, color: '#fff', fontSize: '16px' }}>
                    🗺 Tours ({tours.length})
                </h2>
                <button
                    onClick={onClose}
                    aria-label="Close tour panel"
                    style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '20px', cursor: 'pointer', padding: '0 5px' }}
                >
                    ×
                </button>
            </div>

            <div style={{ display: 'flex' }}>
                <button style={tabBtnStyle(tab === 'library')} onClick={() => setTab('library')}>Library</button>
                <button style={tabBtnStyle(tab === 'record')} onClick={() => setTab('record')}>
                    {isRecording ? '● Recording' : 'Record'}
                </button>
                <button style={tabBtnStyle(tab === 'play')} disabled={!selectedTour} onClick={() => setTab('play')}>Play</button>
            </div>

            <div style={{ padding: '15px', overflowY: 'auto', flex: 1 }}>
                {tab === 'library' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                style={{ flex: 1, padding: '8px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                            >
                                📥 Import JSON
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleImportFile(file);
                                    e.target.value = '';
                                }}
                            />
                        </div>
                        {importError && (
                            <div style={{ color: '#ff8a8a', fontSize: '12px' }}>⚠️ {importError}</div>
                        )}

                        {tours.length === 0 ? (
                            <div style={{ padding: '30px', textAlign: 'center', color: '#888', fontSize: '14px' }}>
                                No tours yet.<br />Record one to get started!
                            </div>
                        ) : (
                            <div role="list" aria-label="Saved tours">
                                {tours.map(tour => (
                                    <div
                                        key={tour.id}
                                        role="listitem"
                                        style={{
                                            padding: '10px',
                                            marginBottom: '8px',
                                            border: `1px solid ${selectedTourId === tour.id ? '#4CAF50' : '#333'}`,
                                            borderRadius: '6px',
                                            backgroundColor: 'rgba(255,255,255,0.03)',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <input
                                                value={tour.name}
                                                onChange={(e) => onRenameTour(tour.id, e.target.value)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                aria-label={`Tour name: ${tour.name}`}
                                                style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: '14px', fontWeight: 'bold' }}
                                            />
                                            <span style={{ color: '#888', fontSize: '11px' }}>{tour.waypoints.length} pts</span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px', margin: '6px 0', fontSize: '12px', color: '#aaa', flexWrap: 'wrap' }}>
                                            <label>
                                                Transition:
                                                <select
                                                    value={tour.transitionType}
                                                    onChange={(e) => onUpdateTourSettings(tour.id, { transitionType: e.target.value as TourTransitionType })}
                                                    style={{ marginLeft: '4px', backgroundColor: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                                                >
                                                    <option value="hold-pause">Hold-pause</option>
                                                    <option value="fade">Fade</option>
                                                </select>
                                            </label>
                                        </div>

                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                            <button
                                                onClick={() => { setSelectedTourId(tour.id); setTab('play'); }}
                                                disabled={tour.waypoints.length === 0}
                                                style={{ padding: '5px 10px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                            >
                                                ▶ Play
                                            </button>
                                            <button
                                                onClick={() => onDownloadTourJson(tour)}
                                                style={{ padding: '5px 10px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                            >
                                                JSON
                                            </button>
                                            <button
                                                onClick={() => onDownloadTourKml(tour)}
                                                style={{ padding: '5px 10px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                            >
                                                KML
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (window.confirm(`Delete tour "${tour.name}"?`)) {
                                                        onDeleteTour(tour.id);
                                                        if (selectedTourId === tour.id) setSelectedTourId(null);
                                                    }
                                                }}
                                                style={{ padding: '5px 10px', backgroundColor: '#d9534f', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'record' && (
                    <TourRecorder
                        isRecording={isRecording}
                        isPaused={isPaused}
                        draftWaypoints={draftWaypoints}
                        currentLocationLabel={currentLocationLabel}
                        onStart={(name) => onStartRecording(name, getCurrentPOV)}
                        onPause={onPauseRecording}
                        onResume={onResumeRecording}
                        onStop={(name) => { onStopRecording(name); setTab('library'); }}
                        onCancel={() => { onCancelRecording(); setTab('library'); }}
                        onAddWaypoint={onAddWaypoint}
                    />
                )}

                {tab === 'play' && selectedTour && (
                    <TourPlayer
                        tour={selectedTour}
                        teleportToPano={teleportToPano}
                        setHeading={setHeading}
                        setPitch={setPitch}
                        setZoom={setZoom}
                        isPanoramaReady={isPanoramaReady}
                    />
                )}
            </div>
        </div>
    );
};

export default TourPanel;
