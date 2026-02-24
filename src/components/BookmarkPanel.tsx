import React, { useState } from 'react';
import { Bookmark } from '../hooks/useBookmarks';

interface BookmarkPanelProps {
    bookmarks: Bookmark[];
    currentCoords: { lat: number; lng: number };
    onTeleport: (lat: number, lng: number, heading: number, pitch: number) => void;
    onAddBookmark: (name: string) => void;
    onRemoveBookmark: (id: string) => void;
    onClose: () => void;
    isOpen: boolean;
}

const BookmarkPanel: React.FC<BookmarkPanelProps> = ({
    bookmarks,
    currentCoords,
    onTeleport,
    onAddBookmark,
    onRemoveBookmark,
    onClose,
    isOpen,
}) => {
    const [newBookmarkName, setNewBookmarkName] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);

    if (!isOpen) return null;

    const handleAdd = () => {
        if (newBookmarkName.trim()) {
            onAddBookmark(newBookmarkName.trim());
            setNewBookmarkName('');
            setShowAddForm(false);
        }
    };

    const formatDate = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
                    📌 Bookmarks ({bookmarks.length})
                </h3>
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

            {/* Add New Bookmark */}
            <div style={{ padding: '15px', borderBottom: '1px solid #444' }}>
                {!showAddForm ? (
                    <button
                        onClick={() => setShowAddForm(true)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            backgroundColor: '#4CAF50',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 'bold',
                        }}
                    >
                        + Save Current Location
                    </button>
                ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            type="text"
                            placeholder="Bookmark name..."
                            value={newBookmarkName}
                            onChange={(e) => setNewBookmarkName(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                            autoFocus
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
                        <button
                            onClick={handleAdd}
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
                            Save
                        </button>
                        <button
                            onClick={() => {
                                setShowAddForm(false);
                                setNewBookmarkName('');
                            }}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#555',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>

            {/* Bookmarks List */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                maxHeight: '400px',
            }}>
                {bookmarks.length === 0 ? (
                    <div style={{
                        padding: '30px',
                        textAlign: 'center',
                        color: '#888',
                        fontSize: '14px',
                    }}>
                        No bookmarks yet.<br />
                        Save your favorite locations!
                    </div>
                ) : (
                    bookmarks.map((bookmark) => (
                        <div
                            key={bookmark.id}
                            style={{
                                padding: '12px 15px',
                                borderBottom: '1px solid #333',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                transition: 'background-color 0.2s',
                                cursor: 'pointer',
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontWeight: 'bold',
                                    color: '#fff',
                                    fontSize: '14px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    marginBottom: '4px',
                                }}>
                                    {bookmark.name}
                                </div>
                                <div style={{
                                    color: '#888',
                                    fontSize: '11px',
                                    fontFamily: 'monospace',
                                }}>
                                    {bookmark.lat.toFixed(4)}, {bookmark.lng.toFixed(4)}
                                </div>
                                <div style={{
                                    color: '#666',
                                    fontSize: '10px',
                                    marginTop: '2px',
                                }}>
                                    {formatDate(bookmark.timestamp)}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <button
                                    onClick={() => onTeleport(bookmark.lat, bookmark.lng, bookmark.heading, bookmark.pitch)}
                                    title="Go to location"
                                    style={{
                                        padding: '6px 10px',
                                        backgroundColor: '#2196F3',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                    }}
                                >
                                    Go
                                </button>
                                <button
                                    onClick={() => onRemoveBookmark(bookmark.id)}
                                    title="Delete bookmark"
                                    style={{
                                        padding: '6px 10px',
                                        backgroundColor: '#d9534f',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default BookmarkPanel;
