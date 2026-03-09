import React, { useState, useRef, useEffect } from 'react';
import { Bookmark } from '../hooks/useBookmarks';
import { useFocusTrap } from '../hooks/useKeyboardShortcuts';

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
    const panelRef = useRef<HTMLDivElement>(null);

    useFocusTrap(panelRef, isOpen);

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

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
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bookmark-panel-title"
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
                <h2 
                    id="bookmark-panel-title"
                    style={{ margin: 0, color: '#fff', fontSize: '16px' }}
                >
                    📌 Bookmarks ({bookmarks.length})
                </h2>
                <button
                    onClick={onClose}
                    aria-label="Close bookmark panel"
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
                        aria-label="Save current location as bookmark"
                    >
                        + Save Current Location
                    </button>
                ) : (
                    <form 
                        onSubmit={(e) => { e.preventDefault(); handleAdd(); }}
                        style={{ display: 'flex', gap: '8px' }}
                    >
                        <input
                            type="text"
                            placeholder="Bookmark name..."
                            value={newBookmarkName}
                            onChange={(e) => setNewBookmarkName(e.target.value)}
                            autoFocus
                            aria-label="Bookmark name"
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
                            type="submit"
                            aria-label="Save bookmark"
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
                            type="button"
                            onClick={() => {
                                setShowAddForm(false);
                                setNewBookmarkName('');
                            }}
                            aria-label="Cancel adding bookmark"
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
                    </form>
                )}
            </div>

            {/* Bookmarks List */}
            <div 
                role="list"
                aria-label="Saved bookmarks"
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    maxHeight: '400px',
                }}
            >
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
                    bookmarks.map((bookmark, index) => (
                        <div
                            key={bookmark.id}
                            role="listitem"
                            tabIndex={0}
                            aria-label={`${bookmark.name}, location ${bookmark.lat.toFixed(4)}, ${bookmark.lng.toFixed(4)}`}
                            style={{
                                padding: '12px 15px',
                                borderBottom: '1px solid #333',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                transition: 'background-color 0.2s',
                                cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    onTeleport(bookmark.lat, bookmark.lng, bookmark.heading, bookmark.pitch);
                                }
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
                                    aria-label={`Go to ${bookmark.name}`}
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
                                    aria-label={`Delete ${bookmark.name}`}
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