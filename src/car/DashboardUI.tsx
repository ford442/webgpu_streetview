import React, { useRef, useEffect } from 'react';

/**
 * DashboardUI - Interactive dashboard controls overlay for the car interior view.
 * Positioned at the bottom of the screen to simulate dashboard instrument controls.
 */

interface DashboardUIProps {
    isVisible: boolean;
    isRadioPlaying: boolean;
    onToggleGPS: () => void;
    onToggleRadio: () => void;
    onRainIntensity: (value: number) => void;
    onSnowIntensity?: (value: number) => void;
    onWind?: (value: number) => void;
    onTimeOfDay: (value: string) => void;
    onToggleRoof: () => void;
    onToggleWipers?: () => void;
    onToggleVehicle?: () => void;
    isRoofOpen: boolean;
    wipersEnabled?: boolean;
    currentVehicle?: 'sedan' | 'convertible' | 'science-lab' | 'limousine';
    rainIntensity: number;
    snowIntensity?: number;
    wind?: number;
    timeOfDay: string;
    audioElement?: HTMLAudioElement | null;
}

const DashboardUI: React.FC<DashboardUIProps> = ({
    isVisible,
    isRadioPlaying,
    onToggleGPS,
    onToggleRadio,
    onRainIntensity,
    onSnowIntensity,
    onWind,
    onTimeOfDay,
    onToggleRoof,
    onToggleWipers,
    onToggleVehicle,
    isRoofOpen,
    wipersEnabled = false,
    currentVehicle = 'sedan',
    rainIntensity,
    snowIntensity = 0,
    wind = 0,
    timeOfDay,
    audioElement,
}) => {
    const visualizerRef = useRef<HTMLCanvasElement>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number>(0);
    const audioCtxRef = useRef<AudioContext | null>(null);

    // Set up audio visualizer when radio is playing
    useEffect(() => {
        if (!isRadioPlaying || !audioElement || !visualizerRef.current) {
            if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
            }
            return;
        }

        try {
            if (!audioCtxRef.current) {
                audioCtxRef.current = new AudioContext();
            }
            const ctx = audioCtxRef.current;

            if (!analyserRef.current) {
                const source = ctx.createMediaElementSource(audioElement);
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 64;
                source.connect(analyser);
                analyser.connect(ctx.destination);
                analyserRef.current = analyser;
            }

            const canvas = visualizerRef.current;
            const canvasCtx = canvas.getContext('2d');
            if (!canvasCtx) return;

            const analyser = analyserRef.current;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const draw = () => {
                analyser.getByteFrequencyData(dataArray);
                canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

                const barWidth = canvas.width / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = (dataArray[i] / 255) * canvas.height;
                    const hue = (i / bufferLength) * 120; // Green spectrum
                    canvasCtx.fillStyle = `hsl(${hue}, 80%, ${40 + (dataArray[i] / 255) * 30}%)`;
                    canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
                    x += barWidth;
                }

                animFrameRef.current = requestAnimationFrame(draw);
            };

            draw();
        } catch (e) {
            console.warn('Audio visualizer initialization failed:', e instanceof Error ? e.message : String(e));
        }

        return () => {
            if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
            }
        };
    }, [isRadioPlaying, audioElement]);

    if (!isVisible) return null;

    const buttonStyle: React.CSSProperties = {
        padding: '8px 14px',
        border: '1px solid rgba(76, 175, 80, 0.4)',
        borderRadius: '6px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: '#4CAF50',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        transition: 'all 0.2s ease',
        fontFamily: 'monospace',
    };

    const activeButtonStyle: React.CSSProperties = {
        ...buttonStyle,
        backgroundColor: 'rgba(76, 175, 80, 0.3)',
        borderColor: '#4CAF50',
        color: '#fff',
    };

    return (
        <div
            data-testid="dashboard-ui"
            role="region"
            aria-label="Car Dashboard Controls"
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                bottom: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '80%',
                maxWidth: '800px',
                padding: '12px 20px',
                background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 30%)',
                borderRadius: '12px 12px 0 0',
                zIndex: 15,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                pointerEvents: 'auto',
            }}
        >
            {/* Top row: Main controls */}
            <div 
                role="group"
                aria-label="Dashboard main controls"
                style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}
            >
                <button
                    onClick={onToggleGPS}
                    style={buttonStyle}
                    aria-label={isRadioPlaying ? "Turn off radio" : "Turn on radio"}
                    aria-pressed={isRadioPlaying}
                    title="Toggle GPS Map (G)"
                >
                    <span aria-hidden="true">🗺️ GPS</span>
                </button>

                {/* Vehicle type toggle */}
                {onToggleVehicle && (
                    <button
                        onClick={onToggleVehicle}
                        style={{
                            ...buttonStyle,
                            backgroundColor: currentVehicle === 'convertible' ? 'rgba(255, 87, 34, 0.3)' : buttonStyle.backgroundColor,
                            borderColor: currentVehicle === 'convertible' ? '#FF5722' : buttonStyle.borderColor,
                        }}
                        aria-label={`Current vehicle: ${currentVehicle}. Click to toggle`}
                        title="Toggle Vehicle Type (V)"
                    >
                        <span aria-hidden="true">{currentVehicle === 'convertible' ? '🏎️ SPORT' : '🚗 SEDAN'}</span>
                    </button>
                )}

                <button
                    onClick={onToggleRadio}
                    style={isRadioPlaying ? activeButtonStyle : buttonStyle}
                    aria-label={isRadioPlaying ? "Turn off radio" : "Turn on radio"}
                    aria-pressed={isRadioPlaying}
                    title="Toggle Radio (M)"
                >
                    <span className="visually-hidden">Radio {isRadioPlaying ? 'On' : 'Off'}</span>
                    <span aria-hidden="true">📻 {isRadioPlaying ? 'ON' : 'OFF'}</span>
                </button>

                <button
                    onClick={onToggleRoof}
                    style={isRoofOpen ? activeButtonStyle : buttonStyle}
                    aria-label={isRoofOpen ? "Close convertible roof" : "Open convertible roof"}
                    aria-pressed={isRoofOpen}
                    title="Toggle Convertible Roof (O)"
                >
                    <span className="visually-hidden">Roof {isRoofOpen ? 'Open' : 'Closed'}</span>
                    <span aria-hidden="true">{isRoofOpen ? '☀️ OPEN' : '🏠 CLOSED'}</span>
                </button>

                {/* Wiper toggle - only show when raining */}
                {rainIntensity > 0 && onToggleWipers && (
                    <button
                        onClick={onToggleWipers}
                        style={wipersEnabled ? activeButtonStyle : buttonStyle}
                        aria-label={wipersEnabled ? "Turn off windshield wipers" : "Turn on windshield wipers"}
                        aria-pressed={wipersEnabled}
                        title="Toggle Windshield Wipers (W)"
                    >
                        <span className="visually-hidden">Wipers {wipersEnabled ? 'On' : 'Off'}</span>
                        <span aria-hidden="true">🧹 {wipersEnabled ? 'ON' : 'OFF'}</span>
                    </button>
                )}

                {/* Time of Day presets */}
                <label className="visually-hidden" htmlFor="time-of-day">Time of Day</label>
                <select
                    id="time-of-day"
                    value={timeOfDay}
                    onChange={(e) => onTimeOfDay(e.target.value)}
                    style={{
                        ...buttonStyle,
                        appearance: 'none',
                        paddingRight: '24px',
                        background: 'rgba(0, 0, 0, 0.7) url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%234CAF50%22%20d%3D%22M2%204l4%204%204-4z%22%2F%3E%3C%2Fsvg%3E") no-repeat right 8px center',
                    }}
                    title="Time of Day (N)"
                    aria-label="Select time of day"
                >
                    <option value="day">☀️ Day</option>
                    <option value="sunset">🌅 Sunset</option>
                    <option value="night">🌙 Night</option>
                </select>
            </div>

            {/* Bottom row: Sliders and visualizer */}
            <div 
                role="group"
                aria-label="Weather and audio controls"
                style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}
            >
                {/* Rain intensity slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label 
                        htmlFor="rain-slider"
                        style={{ color: '#4CAF50', fontSize: '11px', fontFamily: 'monospace' }}
                    >
                        🌧️ Rain
                    </label>
                    <input
                        id="rain-slider"
                        type="range"
                        min="0"
                        max="100"
                        value={rainIntensity}
                        onChange={(e) => onRainIntensity(parseInt(e.target.value))}
                        style={{
                            width: '60px',
                            accentColor: '#4CAF50',
                        }}
                        aria-label={`Rain intensity ${rainIntensity} percent`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={rainIntensity}
                    />
                    <span 
                        style={{ color: '#888', fontSize: '10px', fontFamily: 'monospace', minWidth: '24px' }}
                        aria-hidden="true"
                    >
                        {rainIntensity}%
                    </span>
                </div>

                {/* Snow intensity slider */}
                {onSnowIntensity && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label 
                            htmlFor="snow-slider"
                            style={{ color: '#E3F2FD', fontSize: '11px', fontFamily: 'monospace' }}
                        >
                            ❄️ Snow
                        </label>
                        <input
                            id="snow-slider"
                            type="range"
                            min="0"
                            max="100"
                            value={snowIntensity}
                            onChange={(e) => onSnowIntensity(parseInt(e.target.value))}
                            style={{
                                width: '60px',
                                accentColor: '#90CAF9',
                            }}
                            aria-label={`Snow intensity ${snowIntensity} percent`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={snowIntensity}
                        />
                        <span 
                            style={{ color: '#888', fontSize: '10px', fontFamily: 'monospace', minWidth: '24px' }}
                            aria-hidden="true"
                        >
                            {snowIntensity}%
                        </span>
                    </div>
                )}

                {/* Wind slider */}
                {onWind && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label 
                            htmlFor="wind-slider"
                            style={{ color: '#B3E5FC', fontSize: '11px', fontFamily: 'monospace' }}
                        >
                            💨 Wind
                        </label>
                        <input
                            id="wind-slider"
                            type="range"
                            min="-100"
                            max="100"
                            value={wind}
                            onChange={(e) => onWind(parseInt(e.target.value))}
                            style={{
                                width: '60px',
                                accentColor: '#4FC3F7',
                            }}
                            aria-label={`Wind speed ${wind}`}
                            aria-valuemin={-100}
                            aria-valuemax={100}
                            aria-valuenow={wind}
                        />
                        <span 
                            style={{ color: '#888', fontSize: '10px', fontFamily: 'monospace', minWidth: '28px' }}
                            aria-hidden="true"
                        >
                            {wind > 0 ? '+' : ''}{wind}
                        </span>
                    </div>
                )}

                {/* Audio Visualizer */}
                <div role="img" aria-label={isRadioPlaying ? "Audio visualizer active" : "Audio visualizer"}>
                    <canvas
                        ref={visualizerRef}
                        width={120}
                        height={30}
                        style={{
                            borderRadius: '4px',
                            border: '1px solid rgba(76, 175, 80, 0.3)',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        }}
                        aria-hidden="true"
                    />
                </div>
            </div>
        </div>
    );
};

export default DashboardUI;