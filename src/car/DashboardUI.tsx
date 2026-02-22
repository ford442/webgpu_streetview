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
    onTimeOfDay: (value: string) => void;
    onToggleRoof: () => void;
    isRoofOpen: boolean;
    rainIntensity: number;
    timeOfDay: string;
    audioElement?: HTMLAudioElement | null;
}

const DashboardUI: React.FC<DashboardUIProps> = ({
    isVisible,
    isRadioPlaying,
    onToggleGPS,
    onToggleRadio,
    onRainIntensity,
    onTimeOfDay,
    onToggleRoof,
    isRoofOpen,
    rainIntensity,
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
            // Audio API may not be available in all contexts
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
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <button
                    onClick={onToggleGPS}
                    style={buttonStyle}
                    title="Toggle GPS Map"
                >
                    🗺️ GPS
                </button>

                <button
                    onClick={onToggleRadio}
                    style={isRadioPlaying ? activeButtonStyle : buttonStyle}
                    title="Toggle Radio"
                >
                    📻 {isRadioPlaying ? 'ON' : 'OFF'}
                </button>

                <button
                    onClick={onToggleRoof}
                    style={isRoofOpen ? activeButtonStyle : buttonStyle}
                    title="Toggle Convertible Roof"
                >
                    {isRoofOpen ? '☀️ OPEN' : '🏠 CLOSED'}
                </button>

                {/* Time of Day presets */}
                <select
                    value={timeOfDay}
                    onChange={(e) => onTimeOfDay(e.target.value)}
                    style={{
                        ...buttonStyle,
                        appearance: 'none',
                        paddingRight: '24px',
                        background: 'rgba(0, 0, 0, 0.7) url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%234CAF50%22%20d%3D%22M2%204l4%204%204-4z%22%2F%3E%3C%2Fsvg%3E") no-repeat right 8px center',
                    }}
                    title="Time of Day"
                >
                    <option value="day">☀️ Day</option>
                    <option value="sunset">🌅 Sunset</option>
                    <option value="night">🌙 Night</option>
                </select>
            </div>

            {/* Bottom row: Sliders and visualizer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'center' }}>
                {/* Rain intensity slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#4CAF50', fontSize: '11px', fontFamily: 'monospace' }}>🌧️ Rain</span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={rainIntensity}
                        onChange={(e) => onRainIntensity(parseInt(e.target.value))}
                        style={{
                            width: '80px',
                            accentColor: '#4CAF50',
                        }}
                    />
                    <span style={{ color: '#888', fontSize: '10px', fontFamily: 'monospace', minWidth: '28px' }}>
                        {rainIntensity}%
                    </span>
                </div>

                {/* Audio Visualizer */}
                <canvas
                    ref={visualizerRef}
                    width={120}
                    height={30}
                    style={{
                        borderRadius: '4px',
                        border: '1px solid rgba(76, 175, 80, 0.3)',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    }}
                />
            </div>
        </div>
    );
};

export default DashboardUI;
