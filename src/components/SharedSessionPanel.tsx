import React, { useState } from 'react';
import type { SharedSessionRole, SharedSessionStatus } from '../hooks/useSharedSession';

interface SharedSessionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    role: SharedSessionRole;
    status: SharedSessionStatus;
    error: string | null;
    inviteCode: string | null;
    joinCode: string | null;
    isConnected: boolean;
    onStartHosting: () => void;
    onAdmitGuest: (joinCode: string) => void;
    onJoinWithInviteCode: (inviteCode: string) => void;
    onLeave: () => void;
}

const statusLabel: Record<SharedSessionStatus, string> = {
    idle: 'Not in a session',
    'creating-invite': 'Creating invite…',
    'awaiting-join-code': 'Waiting for guest join code',
    joining: 'Joining…',
    'awaiting-connection': 'Connecting…',
    connected: 'Connected',
    disconnected: 'Disconnected',
    error: 'Error',
};

const SharedSessionPanel: React.FC<SharedSessionPanelProps> = ({
    isOpen,
    onClose,
    role,
    status,
    error,
    inviteCode,
    joinCode,
    isConnected,
    onStartHosting,
    onAdmitGuest,
    onJoinWithInviteCode,
    onLeave,
}) => {
    const [pastedInviteCode, setPastedInviteCode] = useState('');
    const [pastedJoinCode, setPastedJoinCode] = useState('');
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const handleCopy = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can fail (permissions, insecure context); the code
            // is still visible in the textarea for manual copy.
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
                fontFamily: 'monospace',
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
                        <button className="control-btn" style={{ width: '100%' }} onClick={onStartHosting}>
                            Start Session (Host)
                        </button>

                        <div style={{ color: '#888', fontSize: '11px' }}>Have an invite code? Paste it to join:</div>
                        <textarea
                            value={pastedInviteCode}
                            onChange={(e) => setPastedInviteCode(e.target.value)}
                            placeholder="Paste host invite code…"
                            style={{ width: '100%', minHeight: '60px', fontSize: '10px', backgroundColor: '#111', color: '#0f0', border: '1px solid #333', borderRadius: '4px', resize: 'vertical' }}
                        />
                        <button
                            className="control-btn"
                            style={{ width: '100%' }}
                            disabled={!pastedInviteCode.trim()}
                            onClick={() => onJoinWithInviteCode(pastedInviteCode.trim())}
                        >
                            Join Session (Guest)
                        </button>
                    </>
                )}

                {role === 'host' && inviteCode && (
                    <>
                        <div style={{ color: '#888', fontSize: '11px' }}>Share this invite code with guests:</div>
                        <textarea
                            readOnly
                            value={inviteCode}
                            style={{ width: '100%', minHeight: '60px', fontSize: '10px', backgroundColor: '#111', color: '#0f0', border: '1px solid #333', borderRadius: '4px', resize: 'vertical' }}
                            onFocus={(e) => e.currentTarget.select()}
                        />
                        <button className="control-btn" style={{ width: '100%' }} onClick={() => handleCopy(inviteCode)}>
                            {copied ? 'Copied!' : 'Copy Invite Code'}
                        </button>

                        {!isConnected && (
                            <>
                                <div style={{ color: '#888', fontSize: '11px' }}>Paste the guest's join code here:</div>
                                <textarea
                                    value={pastedJoinCode}
                                    onChange={(e) => setPastedJoinCode(e.target.value)}
                                    placeholder="Paste guest join code…"
                                    style={{ width: '100%', minHeight: '60px', fontSize: '10px', backgroundColor: '#111', color: '#0f0', border: '1px solid #333', borderRadius: '4px', resize: 'vertical' }}
                                />
                                <button
                                    className="control-btn"
                                    style={{ width: '100%' }}
                                    disabled={!pastedJoinCode.trim()}
                                    onClick={() => onAdmitGuest(pastedJoinCode.trim())}
                                >
                                    Connect Guest
                                </button>
                            </>
                        )}
                    </>
                )}

                {role === 'guest' && joinCode && (
                    <>
                        <div style={{ color: '#888', fontSize: '11px' }}>Send this join code back to the host:</div>
                        <textarea
                            readOnly
                            value={joinCode}
                            style={{ width: '100%', minHeight: '60px', fontSize: '10px', backgroundColor: '#111', color: '#0f0', border: '1px solid #333', borderRadius: '4px', resize: 'vertical' }}
                            onFocus={(e) => e.currentTarget.select()}
                        />
                        <button className="control-btn" style={{ width: '100%' }} onClick={() => handleCopy(joinCode)}>
                            {copied ? 'Copied!' : 'Copy Join Code'}
                        </button>
                        {isConnected && (
                            <div style={{ color: '#4FC3F7', fontSize: '11px' }}>
                                Following the host's view. Local navigation is disabled while connected.
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
            </div>
        </div>
    );
};

export default SharedSessionPanel;
