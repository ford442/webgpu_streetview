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
                    Hey! Explore the world in a new way.
                </p>

                <div style={{
                    textAlign: 'left',
                    backgroundColor: '#f5f9f5',
                    padding: '20px',
                    borderRadius: '8px',
                    marginBottom: '30px',
                    border: '1px solid #e0e0e0'
                }}>
                    <h3 style={{ marginTop: 0, color: '#2e7d32' }}>Features:</h3>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#555' }}>
                        <li>360° panoramic navigation</li>
                        <li>WebGPU-accelerated rendering</li>
                        <li>Route planning and cruise mode</li>
                        <li>Interactive mini-map</li>
                        <li>Snapshot functionality</li>
                    </ul>
                </div>

                <button
                    onClick={onStart}
                    style={{
                        backgroundColor: '#2e7d32',
                        color: 'white',
                        border: 'none',
                        padding: '12px 30px',
                        borderRadius: '6px',
                        fontSize: '1.1rem',
                        cursor: 'pointer',
                        transition: 'background-color 0.3s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1b5e20'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2e7d32'}
                >
                    Start Exploring
                </button>
            </div>
        </div>
    );
};

export default WelcomeModal;