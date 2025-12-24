import React from 'react';

interface WelcomeModalProps {
    onStart: () => void;
}

const WelcomeModal: React.FC<WelcomeModalProps> = ({ onStart }) => {
    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backdropFilter: 'blur(5px)'
        }}>
            <div style={{
                backgroundColor: '#ffffff',
                padding: '40px',
                borderRadius: '12px',
                maxWidth: '600px',
                width: '90%',
                boxShadow: '0 10px 25px rgba(0, 255, 0, 0.2)',
                textAlign: 'center',
                color: '#333'
            }}>
                <h1 style={{
                    color: '#2e7d32', // Green
                    marginTop: 0,
                    marginBottom: '20px',
                    fontSize: '2.5rem',
                    letterSpacing: '-1px'
                }}>
                    1ink.us Streetview
                </h1>

                <p style={{ fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '30px', color: '#555' }}>
                    Explore the world in a new way.
                </p>

                <div style={{
                    textAlign: 'left',
                    backgroundColor: '#f5f9f5',
                    padding: '20px',
                    borderRadius: '8px',
                    marginBottom: '30px',
                    borderLeft: '4px solid #2e7d32'
                }}>
                    <h3 style={{ marginTop: 0, color: '#2e7d32' }}>Controls</h3>
                    <ul style={{ paddingLeft: '20px', margin: 0 }}>
                        <li style={{ marginBottom: '8px' }}><strong>Mouse Drag:</strong> Look around (Pan/Tilt)</li>
                        <li style={{ marginBottom: '8px' }}><strong>Scroll:</strong> Zoom In / Out</li>
                        <li style={{ marginBottom: '8px' }}><strong>WASD / Arrow Keys:</strong> Move position</li>
                        <li style={{ marginBottom: '8px' }}><strong>Right Click:</strong> Move forward quickly</li>
                        <li><strong>Map Button:</strong> Open map and plan routes</li>
                    </ul>
                </div>

                <button
                    onClick={onStart}
                    style={{
                        backgroundColor: '#2e7d32',
                        color: 'white',
                        border: 'none',
                        padding: '15px 40px',
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        borderRadius: '30px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 4px 6px rgba(46, 125, 50, 0.3)'
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = '#1b5e20';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 6px 12px rgba(46, 125, 50, 0.4)';
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = '#2e7d32';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 4px 6px rgba(46, 125, 50, 0.3)';
                    }}
                >
                    Start Exploring
                </button>
            </div>
        </div>
    );
};

export default WelcomeModal;
