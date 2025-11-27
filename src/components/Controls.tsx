import React, { useEffect, useRef } from 'react';
import { RenderMode } from '../renderer/types';

interface ControlsProps {
    mode: RenderMode;
    heading: number;
    pitch: number;
    zoom: number;
    mapVisible: boolean;
    setMapVisible: (visible: boolean) => void;
    onUpdatePOV: (heading: number, pitch: number) => void;
    onUpdateZoom: (zoom: number) => void;
    onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
    panorama: google.maps.StreetViewPanorama | null;
}

const Controls: React.FC<ControlsProps> = ({
    mode,
    heading,
    pitch,
    zoom,
    mapVisible,
    setMapVisible,
    onUpdatePOV,
    onUpdateZoom,
    onMove,
    panorama,
}) => {
    const minimapRef = useRef<HTMLDivElement>(null);
    const minimapInstance = useRef<google.maps.Map | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);

    // Initialize minimap
    useEffect(() => {
        if (!minimapRef.current || !window.google || !window.google.maps || !panorama) return;

        const position = panorama.getPosition();
        if (!position) return;

        // Create minimap
        const map = new window.google.maps.Map(minimapRef.current, {
            center: { lat: position.lat(), lng: position.lng() },
            zoom: 16,
            mapTypeId: 'roadmap',
            disableDefaultUI: true,
            zoomControl: true,
        });

        minimapInstance.current = map;

        // Create marker
        const marker = new window.google.maps.Marker({
            position: { lat: position.lat(), lng: position.lng() },
            map: map,
            title: 'Current Position',
        });

        markerRef.current = marker;

        // Listen to panorama position changes
        panorama.addListener('position_changed', () => {
            const newPos = panorama.getPosition();
            if (newPos && marker && map) {
                marker.setPosition(newPos);
                map.setCenter(newPos);
            }
        });

        // Allow clicking on minimap to teleport
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
            if (e.latLng && panorama) {
                panorama.setPosition(e.latLng);
            }
        });

    }, [panorama]);

    return (
        <div className="controls">
            <div className="control-group">
                <label>Mode: {mode}</label>
            </div>
            
            <div className="control-group">
                <h3>Navigation Controls</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', maxWidth: '150px' }}>
                    <button onClick={() => onMove('forward')} style={{ gridColumn: '2' }}>↑</button>
                    <button onClick={() => onMove('left')} style={{ gridColumn: '1', gridRow: '2' }}>←</button>
                    <button onClick={() => onMove('backward')} style={{ gridColumn: '2', gridRow: '2' }}>↓</button>
                    <button onClick={() => onMove('right')} style={{ gridColumn: '3', gridRow: '2' }}>→</button>
                </div>
            </div>

            <div className="control-group">
                <label htmlFor="heading-slider">Heading: {heading.toFixed(0)}°</label>
                <input 
                    type="range" 
                    id="heading-slider" 
                    min="0" 
                    max="360" 
                    value={heading} 
                    onChange={(e) => onUpdatePOV(Number(e.target.value), pitch)} 
                />
            </div>

            <div className="control-group">
                <label htmlFor="pitch-slider">Pitch: {pitch.toFixed(0)}°</label>
                <input 
                    type="range" 
                    id="pitch-slider" 
                    min="-90" 
                    max="90" 
                    value={pitch} 
                    onChange={(e) => onUpdatePOV(heading, Number(e.target.value))} 
                />
            </div>

            <div className="control-group">
                <label htmlFor="zoom-slider">Zoom: {zoom.toFixed(1)}x</label>
                <input 
                    type="range" 
                    id="zoom-slider" 
                    min="0" 
                    max="4" 
                    step="0.1"
                    value={zoom} 
                    onChange={(e) => onUpdateZoom(Number(e.target.value))} 
                />
            </div>

            <div className="control-group">
                <label>
                    <input 
                        type="checkbox" 
                        checked={mapVisible} 
                        onChange={(e) => setMapVisible(e.target.checked)} 
                    />
                    Show Minimap
                </label>
            </div>

            {mapVisible && (
                <div className="control-group">
                    <h3>Minimap</h3>
                    <div 
                        ref={minimapRef} 
                        style={{ 
                            width: '100%', 
                            height: '200px', 
                            border: '1px solid #ccc',
                            borderRadius: '4px'
                        }} 
                    />
                    <small style={{ color: '#666', display: 'block', marginTop: '5px' }}>
                        Click on the map to teleport to that location
                    </small>
                </div>
            )}
        </div>
    );
};

export default Controls;
