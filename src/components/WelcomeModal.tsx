import React from 'react';

import PlaceSearchBar from './PlaceSearchBar';
import type { UsePlaceSearchResult } from '../hooks/usePlaceSearch';

interface WelcomeModalProps {
    onStart: () => void;
    search?: UsePlaceSearchResult;
}

const WelcomeModal: React.FC<WelcomeModalProps> = ({ onStart, search }) => {
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
            aria-describedby="welcome-description"
            className="sv-welcome"
        >
            <div className="sv-welcome__card">
                <h1 id="welcome-title" className="sv-welcome__title">
                    1ink.us Streetview
                </h1>

                <p 
                    id="welcome-description"
                    style={{ fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '20px', color: '#555' }}
                >
                    Hey! Explore the world in a new way. Search a destination to drop onto Street View coverage.
                </p>

                {search && (
                    <div style={{ marginBottom: 24, textAlign: 'left' }}>
                        <PlaceSearchBar search={search} />
                    </div>
                )}

                <div style={{
                    textAlign: 'left',
                    backgroundColor: '#f5f9f5',
                    padding: '20px',
                    borderRadius: '8px',
                    marginBottom: '30px',
                    border: '1px solid #e0e0e0'
                }}>
                    <h2 style={{ marginTop: 0, color: '#2e7d32', fontSize: '1.2rem' }}>Features:</h2>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#555' }}>
                        <li>360° panoramic navigation</li>
                        <li>WebGPU-accelerated rendering</li>
                        <li>Route planning and cruise mode</li>
                        <li>Interactive mini-map</li>
                        <li>Snapshot functionality</li>
                        <li>Keyboard navigation support</li>
                        <li>Screen reader compatible</li>
                    </ul>
                </div>

                <button
                    onClick={onStart}
                    autoFocus
                    style={{
                        backgroundColor: '#2e7d32',
                        color: 'white',
                        border: 'none',
                        padding: '12px 30px',
                        borderRadius: '6px',
                        fontSize: '1.1rem',
                        cursor: 'pointer',
                        transition: 'background-color 0.3s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1b5e20'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2e7d32'}
                    onFocus={(e) => e.currentTarget.style.backgroundColor = '#1b5e20'}
                    onBlur={(e) => e.currentTarget.style.backgroundColor = '#2e7d32'}
                    aria-label="Start exploring Street View. Press Enter to begin."
                >
                    Start Exploring
                </button>

                <div style={{ marginTop: '20px', fontSize: '0.9rem', color: '#595959' }}>
                    <p>Press <kbd>Tab</kbd> to navigate, <kbd>Enter</kbd> to select</p>
                </div>
            </div>
        </div>
    );
};

export default WelcomeModal;