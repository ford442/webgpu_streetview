import React, { useState } from 'react';
import { SnapshotMetadata, SnapshotShareResult } from '../hooks/useSnapshots';
import { ImageExportFormat } from '../utils/imageExport';

interface SnapshotGalleryProps {
    snapshots: SnapshotMetadata[];
    isOffline?: boolean;
    onRemoveSnapshot: (id: string) => void;
    onUpdateName: (id: string, name: string) => void;
    onDownload: (snapshot: SnapshotMetadata, format: ImageExportFormat) => void;
    onShare: (snapshot: SnapshotMetadata, format: ImageExportFormat) => Promise<SnapshotShareResult>;
    onCopyLink: (snapshot: SnapshotMetadata) => string;
    onTeleport: (lat: number, lng: number, heading: number, pitch: number, panoId?: string) => void;
    onClose: () => void;
    onClearAll: () => void;
    isOpen: boolean;
}

const FORMAT_OPTIONS: { value: ImageExportFormat; label: string }[] = [
    { value: 'png', label: 'PNG' },
    { value: 'jpeg', label: 'JPEG (+GPS EXIF)' },
    { value: 'webp', label: 'WebP' },
];

const SnapshotGallery: React.FC<SnapshotGalleryProps> = ({
    snapshots,
    isOffline = false,
    onRemoveSnapshot,
    onUpdateName,
    onDownload,
    onShare,
    onCopyLink,
    onTeleport,
    onClose,
    onClearAll,
    isOpen,
}) => {
    const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotMetadata | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [exportFormat, setExportFormat] = useState<ImageExportFormat>('png');
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleCopyLink = async (snapshot: SnapshotMetadata) => {
        const link = onCopyLink(snapshot);
        try {
            await navigator.clipboard.writeText(link);
            setStatusMessage('Link copied to clipboard');
        } catch (error) {
            console.error('Failed to copy link:', error);
            setStatusMessage('Could not copy link');
        }
        setTimeout(() => setStatusMessage(null), 2500);
    };

    const handleShare = async (snapshot: SnapshotMetadata) => {
        const result = await onShare(snapshot, exportFormat === 'png' ? 'jpeg' : exportFormat);
        if (result === 'clipboard') setStatusMessage('Web Share unavailable — link copied to clipboard');
        else if (result === 'share') setStatusMessage('Shared successfully');
        if (result !== 'cancelled') setTimeout(() => setStatusMessage(null), 2500);
    };

    const formatDate = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const startEditing = (snapshot: SnapshotMetadata) => {
        setEditingId(snapshot.id);
        setEditName(snapshot.name);
    };

    const saveEdit = () => {
        if (editingId && editName.trim()) {
            onUpdateName(editingId, editName.trim());
            setEditingId(null);
            setEditName('');
        }
    };

    // Modal for viewing full image
    if (selectedSnapshot) {
        return (
            <div
                onClick={() => setSelectedSnapshot(null)}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: 'rgba(0,0,0,0.9)',
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px',
                }}
            >
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        maxWidth: '90vw',
                        maxHeight: '80vh',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                    }}
                >
                    <img
                        src={selectedSnapshot.dataUrl}
                        alt={selectedSnapshot.name}
                        style={{
                            maxWidth: '100%',
                            maxHeight: '70vh',
                            borderRadius: '8px',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                        }}
                    />
                    <div style={{
                        marginTop: '15px',
                        color: '#fff',
                        textAlign: 'center',
                    }}>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
                            {selectedSnapshot.name}
                        </div>
                        <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>
                            {formatDate(selectedSnapshot.timestamp)} | {selectedSnapshot.lat.toFixed(4)}, {selectedSnapshot.lng.toFixed(4)}
                        </div>
                        <div style={{ marginBottom: '10px' }}>
                            <select
                                value={exportFormat}
                                onChange={(e) => setExportFormat(e.target.value as ImageExportFormat)}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #555',
                                    backgroundColor: '#222',
                                    color: '#fff',
                                    fontSize: '12px',
                                }}
                            >
                                {FORMAT_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => onTeleport(selectedSnapshot.lat, selectedSnapshot.lng, selectedSnapshot.heading, selectedSnapshot.pitch, selectedSnapshot.panoId)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#2196F3',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                }}
                            >
                                🚀 Go to Location
                            </button>
                            <button
                                onClick={() => onDownload(selectedSnapshot, exportFormat)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#4CAF50',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                }}
                            >
                                💾 Download
                            </button>
                            <button
                                onClick={() => handleShare(selectedSnapshot)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#9c27b0',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                }}
                            >
                                📤 Share
                            </button>
                            <button
                                onClick={() => handleCopyLink(selectedSnapshot)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#607d8b',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                }}
                            >
                                🔗 Copy Link
                            </button>
                            <button
                                onClick={() => setSelectedSnapshot(null)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#555',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                }}
                            >
                                Close
                            </button>
                        </div>
                        {statusMessage && (
                            <div style={{ marginTop: '10px', fontSize: '12px', color: '#8bc34a' }}>
                                {statusMessage}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                top: '80px',
                right: '20px',
                width: '340px',
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
                    📸 Snapshots ({snapshots.length})
                </h3>
                {isOffline && (
                    <span style={{ fontSize: 11, color: '#ffb74d', marginLeft: 8 }}>Offline</span>
                )}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {snapshots.length > 0 && (
                        <select
                            value={exportFormat}
                            onChange={(e) => setExportFormat(e.target.value as ImageExportFormat)}
                            title="Export format"
                            style={{
                                padding: '2px 4px',
                                borderRadius: '3px',
                                border: '1px solid #555',
                                backgroundColor: '#222',
                                color: '#fff',
                                fontSize: '10px',
                            }}
                        >
                            {FORMAT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    )}
                    {snapshots.length > 0 && (
                        <button
                            onClick={onClearAll}
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

            {statusMessage && (
                <div style={{ padding: '6px 15px', fontSize: '11px', color: '#8bc34a', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                    {statusMessage}
                </div>
            )}

            {/* Snapshots Grid */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                maxHeight: '400px',
                padding: '10px',
            }}>
                {snapshots.length === 0 ? (
                    <div style={{
                        padding: '30px',
                        textAlign: 'center',
                        color: '#888',
                        fontSize: '14px',
                    }}>
                        No snapshots saved yet.<br />
                        Take a snapshot to see it here!
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '10px',
                    }}>
                        {snapshots.map((snapshot) => (
                            <div
                                key={snapshot.id}
                                style={{
                                    backgroundColor: 'rgba(0,0,0,0.3)',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    border: '1px solid #333',
                                }}
                            >
                                <img
                                    src={snapshot.dataUrl}
                                    alt={snapshot.name}
                                    onClick={() => setSelectedSnapshot(snapshot)}
                                    style={{
                                        width: '100%',
                                        height: '100px',
                                        objectFit: 'cover',
                                        cursor: 'pointer',
                                    }}
                                />
                                <div style={{ padding: '8px' }}>
                                    {editingId === snapshot.id ? (
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                onKeyPress={(e) => e.key === 'Enter' && saveEdit()}
                                                onBlur={saveEdit}
                                                autoFocus
                                                style={{
                                                    flex: 1,
                                                    padding: '4px 6px',
                                                    border: '1px solid #555',
                                                    borderRadius: '3px',
                                                    backgroundColor: '#333',
                                                    color: '#fff',
                                                    fontSize: '11px',
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <div
                                            onClick={() => startEditing(snapshot)}
                                            style={{
                                                fontSize: '11px',
                                                color: '#fff',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                cursor: 'pointer',
                                                padding: '4px 0',
                                            }}
                                            title="Click to rename"
                                        >
                                            {snapshot.name}
                                        </div>
                                    )}
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginTop: '4px',
                                    }}>
                                        <span style={{ fontSize: '9px', color: '#666' }}>
                                            {formatDate(snapshot.timestamp)}
                                        </span>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button
                                                onClick={() => onDownload(snapshot, exportFormat)}
                                                title="Download"
                                                style={{
                                                    padding: '2px 6px',
                                                    backgroundColor: '#4CAF50',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    fontSize: '10px',
                                                }}
                                            >
                                                ⬇
                                            </button>
                                            <button
                                                onClick={() => handleShare(snapshot)}
                                                title="Share"
                                                style={{
                                                    padding: '2px 6px',
                                                    backgroundColor: '#9c27b0',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    fontSize: '10px',
                                                }}
                                            >
                                                📤
                                            </button>
                                            <button
                                                onClick={() => handleCopyLink(snapshot)}
                                                title="Copy link"
                                                style={{
                                                    padding: '2px 6px',
                                                    backgroundColor: '#607d8b',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    fontSize: '10px',
                                                }}
                                            >
                                                🔗
                                            </button>
                                            <button
                                                onClick={() => onRemoveSnapshot(snapshot.id)}
                                                title="Delete"
                                                style={{
                                                    padding: '2px 6px',
                                                    backgroundColor: '#d9534f',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    fontSize: '10px',
                                                }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SnapshotGallery;
