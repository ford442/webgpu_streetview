import React, { useState } from 'react';
import type {
  SharedSessionParticipant,
  SharedSessionRole,
  SharedSessionStatus,
} from '../hooks/useSharedSession';

interface SharedSessionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    role: SharedSessionRole;
    status: SharedSessionStatus;
    error: string | null;
    roomCode: string | null;
    participants: SharedSessionParticipant[];
    isConnected: boolean;
    onCreateRoom: () => void;
    onJoinRoom: (code: string) => void;
    onLeave: () => void;
}

const statusLabel: Record<SharedSessionStatus, string> = {
    idle: 'Not in a session',
    'creating-room': 'Creating room…',
    'awaiting-guests': 'Waiting for guests to join',
    'joining-room': 'Joining…',
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Disconnected',
    'host-left': 'Host left the session',
    error: 'Error',
};

const SharedSessionPanel: React.FC<SharedSessionPanelProps> = ({
    isOpen,
    onClose,
    role,
    status,
    error,
    roomCode,
    participants,
    isConnected,
    onCreateRoom,
    onJoinRoom,
    onLeave,
}) => {
    const [codeInput, setCodeInput] = useState('');
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const handleCopy = async () => {
        if (!roomCode) return;
        try {
            await navigator.clipboard.writeText(roomCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can fail (permissions, insecure context); the code
            // is still visible on screen for manual copy.
        }
    };

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
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
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                fontFamily: 'system-ui, sans-serif',
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
                <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>
                    🚗 Road Trip
                </h3>
                <button
                    onClick={onClose}
                    aria-label="Close road trip panel"
                    style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '20px', cursor: 'pointer', padding: '0 5px' }}
                >
                    ×
                </button>
            </div>

            <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ color: isConnected ? '#4FC3F7' : '#aaa', fontSize: '12px' }}>
                    {role ? `Role: ${role}` : 'Solo'} — {statusLabel[status]}
                </div>

                {error && (
                    <div style={{ color: '#ff6b6b', fontSize: '11px' }}>{error}</div>
                )}

                {!role && (
                    <>
                        <button className="control-btn" style={{ width: '100%' }} onClick={onCreateRoom}>
                            Start Session (Host)
                        </button>

                        <div style={{ color: '#888', fontSize: '11px' }}>Have a room code? Join with it:</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                                value={codeInput}
                                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                                placeholder="ABCDEF"
                                maxLength={8}
                                aria-label="Room code"
                                style={{
                                    flex: 1,
                                    fontFamily: 'monospace',
                                    fontSize: '16px',
                                    letterSpacing: '2px',
                                    textAlign: 'center',
                                    backgroundColor: '#111',
                                    color: '#0f0',
                                    border: '1px solid #333',
                                    borderRadius: '4px',
                                    padding: '8px',
                                }}
                            />
                        </div>
                        <button
                            className="control-btn"
                            style={{ width: '100%' }}
                            disabled={!codeInput.trim()}
                            onClick={() => onJoinRoom(codeInput.trim())}
                        >
                            Join Session (Guest)
                        </button>
                    </>
                )}

                {role && roomCode && (
                    <>
                        <div style={{ color: '#888', fontSize: '11px' }}>
                            {role === 'host' ? 'Share this room code with guests:' : 'Room code:'}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <div
                                style={{
                                    flex: 1,
                                    fontFamily: 'monospace',
                                    fontSize: '20px',
                                    letterSpacing: '4px',
                                    textAlign: 'center',
                                    backgroundColor: '#111',
                                    color: '#0f0',
                                    border: '1px solid #333',
                                    borderRadius: '4px',
                                    padding: '10px',
                                }}
                            >
                                {roomCode}
                            </div>
                            <button className="control-btn" onClick={() => void handleCopy()}>
                                {copied ? '✓' : 'Copy'}
                            </button>
                        </div>

                        {participants.length > 0 && (
                            <div>
                                <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}>
                                    In this room ({participants.length}):
                                </div>
                                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {participants.map((p) => (
                                        <li
                                            key={p.clientId}
                                            style={{
                                                fontSize: '12px',
                                                color: '#ddd',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                            }}
                                        >
                                            <span>{p.role === 'host' ? '🧭' : '🚙'}</span>
                                            <span>{p.role === 'host' ? 'Host' : 'Guest'}{p.isSelf ? ' (you)' : ''}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {role === 'guest' && isConnected && (
                            <div style={{ color: '#4FC3F7', fontSize: '11px' }}>
                                Following the host's view. Local navigation is disabled while connected.
                            </div>
                        )}

                        {status === 'host-left' && (
                            <div style={{ color: '#ff6b6b', fontSize: '11px' }}>
                                The host left this room. Leave and rejoin with a new code to continue.
                            </div>
                        )}
                    </>
                )}

                {role && (
                    <button
                        className="control-btn disconnect"
                        style={{ width: '100%', backgroundColor: 'rgba(255,71,87,0.85)' }}
                        onClick={onLeave}
                    >
                        Leave Session
                    </button>
                )}

                <p style={{ margin: 0, fontSize: '10px', color: '#666', lineHeight: 1.4 }}>
                    Peer-to-peer over WebRTC (STUN only, no TURN server yet) — works on most networks, but very
                    restrictive corporate/mobile networks on both ends may fail to connect. Only pano IDs and
                    view angles are shared, never Street View imagery.
                </p>
            </div>
        </div>
    );
};

export default SharedSessionPanel;
