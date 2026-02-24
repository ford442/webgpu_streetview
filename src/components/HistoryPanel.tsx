import React from 'react';
import { HistoryEntry } from '../hooks/useLocationHistory';

interface HistoryPanelProps {
    history: HistoryEntry[];
    onTeleport: (lat: number, lng: number, heading: number, pitch: number) => void;
    onRemoveEntry: (id: string) => void;
    onClearHistory: () => void;
    onClose: () => void;
    isOpen: boolean;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({
    history,
    onTeleport,
    onRemoveEntry,
    onClearHistory,
    onClose,
    isOpen,
}) => {
    if (!isOpen) return null;

    const formatDate = (timestamp: string) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                top: '80px',
                right: '20px',
                width: '320px',
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
            {/* Header */}
            <div style={{
                padding: '15px',
                borderBottom: '1px solid #444',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'rgba(0,0,0,0.3)',
            }}>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>
                    🕐 History ({history.length})
                </h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                    {history.length > 0 && (
                        <button
                            onClick={onClearHistory}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#d9534f',
                                fontSize: '12px',
                                cursor: 'pointer',
                                padding: '4px 8px',
                            }}
                        >
                            Clear All
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#aaa',
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '0 5px',
                        }}
                    >
                        ×
                    </button>
                </div>
            </div>

            {/* History List */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                maxHeight: '400px',
            }}>
                {history.length === 0 ? (
                    <div style={{
                        padding: '30px',
                        textAlign: 'center',
                        color: '#888',
                        fontSize: '14px',
                    }}>
                        No history yet.<br />
                        Your visited locations will appear here!
                    </div>
                ) : (
                    history.map((entry) => (
                        <div
                            key={entry.id}
                            style={{
                                padding: '12px 15px',
                                borderBottom: '1px solid #333',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s',
                            }}
                            onClick={() => onTeleport(entry.lat, entry.lng, entry.heading, entry.pitch)}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.05)';
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
                            }}
                        >
                            <div style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: '#2196F3',
                                flexShrink: 0,
                            }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    color: '#fff',
                                    fontSize: '13px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    marginBottom: '2px',
                                }}>
                                    {entry.locationName || 'Unknown Location'}
                                </div>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}>
                                    <span style={{
                                        color: '#888',
                                        fontSize: '11px',
                                        fontFamily: 'monospace',
                                    }}>
                                        {entry.lat.toFixed(4)}, {entry.lng.toFixed(4)}
                                    </span>
                                    <span style={{
                                        color: '#666',
                                        fontSize: '10px',
                                    }}>
                                        {formatDate(entry.timestamp)}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveEntry(entry.id);
                                }}
                                title="Remove from history"
                                style={{
                                    padding: '4px 8px',
                                    backgroundColor: 'transparent',
                                    color: '#666',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    lineHeight: 1,
                                }}
                                onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.color = '#d9534f';
                                }}
                                onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.color = '#666';
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default HistoryPanel;
