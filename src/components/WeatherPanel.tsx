import React from 'react';

interface WeatherPanelProps {
    rainIntensity: number;
    snowIntensity: number;
    wind: number;
    wipersEnabled: boolean;
    timeOfDay: 'day' | 'sunset' | 'night';
    onRainIntensity: (value: number) => void;
    onSnowIntensity: (value: number) => void;
    onWind: (value: number) => void;
    onToggleWipers: () => void;
    onTimeOfDay: (value: string) => void;
    onClose: () => void;
    isOpen: boolean;
}

const WeatherPanel: React.FC<WeatherPanelProps> = ({
    rainIntensity,
    snowIntensity,
    wind,
    wipersEnabled,
    timeOfDay,
    onRainIntensity,
    onSnowIntensity,
    onWind,
    onToggleWipers,
    onTimeOfDay,
    onClose,
    isOpen,
}) => {
    if (!isOpen) return null;

    const sliderStyle: React.CSSProperties = {
        width: '100%',
        margin: '5px 0',
        accentColor: '#4FC3F7',
    };

    const labelStyle: React.CSSProperties = {
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'monospace',
        display: 'block',
        marginBottom: '2px',
    };

    const valueStyle: React.CSSProperties = {
        color: '#4FC3F7',
        fontSize: '11px',
        fontFamily: 'monospace',
        float: 'right',
    };

    const todBtnStyle = (active: boolean): React.CSSProperties => ({
        padding: '6px 12px',
        margin: '2px',
        border: `1px solid ${active ? '#4FC3F7' : '#555'}`,
        borderRadius: '4px',
        backgroundColor: active ? 'rgba(79,195,247,0.25)' : 'rgba(0,0,0,0.5)',
        color: active ? '#4FC3F7' : '#aaa',
        cursor: 'pointer',
        fontSize: '11px',
        fontFamily: 'monospace',
        transition: 'all 0.15s',
    });

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                top: '80px',
                right: '20px',
                width: '300px',
                maxHeight: 'calc(100vh - 120px)',
                backgroundColor: 'rgba(20, 28, 38, 0.96)',
                borderRadius: '12px',
                border: '1px solid #2a4a6a',
                zIndex: 100,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
        >
            {/* Header */}
            <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid #2a4a6a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'rgba(0,0,0,0.3)',
            }}>
                <h3 style={{ margin: 0, color: '#4FC3F7', fontSize: '15px', letterSpacing: '0.5px' }}>
                    🌧️ Weather &amp; Atmosphere
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
                        lineHeight: 1,
                    }}
                    aria-label="Close weather panel"
                >
                    ×
                </button>
            </div>

            {/* Controls */}
            <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>

                {/* Time of Day */}
                <div style={{ marginBottom: '18px' }}>
                    <div style={{ ...labelStyle, marginBottom: '8px' }}>Time of Day:</div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {(['day', 'sunset', 'night'] as const).map(tod => (
                            <button
                                key={tod}
                                onClick={() => onTimeOfDay(tod)}
                                style={todBtnStyle(timeOfDay === tod)}
                            >
                                {tod === 'day' ? '☀️ Day' : tod === 'sunset' ? '🌅 Sunset' : '🌙 Night'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Rain */}
                <div style={{ marginBottom: '16px' }}>
                    <label style={labelStyle}>
                        🌧️ Rain <span style={valueStyle}>{rainIntensity}</span>
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={rainIntensity}
                        onChange={(e) => onRainIntensity(parseInt(e.target.value))}
                        style={sliderStyle}
                    />
                </div>

                {/* Snow */}
                <div style={{ marginBottom: '16px' }}>
                    <label style={labelStyle}>
                        ❄️ Snow <span style={valueStyle}>{snowIntensity}</span>
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={snowIntensity}
                        onChange={(e) => onSnowIntensity(parseInt(e.target.value))}
                        style={sliderStyle}
                    />
                </div>

                {/* Wind */}
                <div style={{ marginBottom: '18px' }}>
                    <label style={labelStyle}>
                        💨 Wind direction{' '}
                        <span style={valueStyle}>
                            {wind < -20 ? '←' : wind > 20 ? '→' : '↕'} {Math.abs(wind)}
                        </span>
                    </label>
                    <input
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={wind}
                        onChange={(e) => onWind(parseInt(e.target.value))}
                        style={{ ...sliderStyle, accentColor: '#80CBC4' }}
                    />
                </div>

                {/* Wipers */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    borderRadius: '8px',
                    border: `1px solid ${wipersEnabled ? '#4FC3F7' : '#333'}`,
                }}>
                    <span style={{ color: '#ddd', fontSize: '13px', fontFamily: 'monospace' }}>
                        🚗 Windshield Wipers
                    </span>
                    <button
                        onClick={onToggleWipers}
                        style={{
                            padding: '5px 14px',
                            border: 'none',
                            borderRadius: '12px',
                            backgroundColor: wipersEnabled ? '#4FC3F7' : '#444',
                            color: wipersEnabled ? '#000' : '#aaa',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            transition: 'all 0.15s',
                        }}
                        aria-pressed={wipersEnabled}
                    >
                        {wipersEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>

                {/* Presets */}
                <div style={{ marginTop: '18px' }}>
                    <div style={{ ...labelStyle, marginBottom: '8px' }}>Quick Presets:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {[
                            { label: '☀️ Clear', rain: 0, snow: 0, wind: 0 },
                            { label: '🌧️ Rain', rain: 60, snow: 0, wind: 30 },
                            { label: '⛈️ Storm', rain: 100, snow: 0, wind: 80 },
                            { label: '❄️ Snow', rain: 0, snow: 70, wind: -20 },
                            { label: '🌨️ Blizzard', rain: 0, snow: 100, wind: -90 },
                        ].map(p => (
                            <button
                                key={p.label}
                                onClick={() => {
                                    onRainIntensity(p.rain);
                                    onSnowIntensity(p.snow);
                                    onWind(p.wind);
                                }}
                                style={{
                                    padding: '5px 9px',
                                    margin: '1px',
                                    border: '1px solid #2a4a6a',
                                    borderRadius: '4px',
                                    backgroundColor: 'rgba(0,0,0,0.5)',
                                    color: '#ccc',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontFamily: 'monospace',
                                }}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WeatherPanel;
