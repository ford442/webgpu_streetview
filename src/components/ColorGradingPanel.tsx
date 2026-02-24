import React from 'react';

interface ColorGradingPanelProps {
    vibrance: number;
    saturation: number;
    contrast: number;
    exposure: number;
    temperature: number;
    tint: number;
    onVibranceChange: (value: number) => void;
    onSaturationChange: (value: number) => void;
    onContrastChange: (value: number) => void;
    onExposureChange: (value: number) => void;
    onTemperatureChange: (value: number) => void;
    onTintChange: (value: number) => void;
    onPreset: (preset: string) => void;
    onClose: () => void;
    isOpen: boolean;
}

const ColorGradingPanel: React.FC<ColorGradingPanelProps> = ({
    vibrance,
    saturation,
    contrast,
    exposure,
    temperature,
    tint,
    onVibranceChange,
    onSaturationChange,
    onContrastChange,
    onExposureChange,
    onTemperatureChange,
    onTintChange,
    onPreset,
    onClose,
    isOpen,
}) => {
    if (!isOpen) return null;

    const sliderStyle = {
        width: '100%',
        margin: '5px 0',
        accentColor: '#4CAF50',
    };

    const labelStyle = {
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'monospace',
        display: 'block',
        marginBottom: '2px',
    };

    const valueStyle = {
        color: '#4CAF50',
        fontSize: '11px',
        fontFamily: 'monospace',
        float: 'right' as const,
    };

    const presetButtonStyle = {
        padding: '6px 10px',
        margin: '2px',
        border: '1px solid #555',
        borderRadius: '4px',
        backgroundColor: 'rgba(0,0,0,0.5)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '11px',
        fontFamily: 'monospace',
    };

    return (
        <div
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
                <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>
                    🎨 Color Grading
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
                    }}
                >
                    ×
                </button>
            </div>

            {/* Presets */}
            <div style={{ padding: '15px', borderBottom: '1px solid #444' }}>
                <div style={{ ...labelStyle, marginBottom: '8px' }}>Presets:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {['daylight', 'golden', 'sunset', 'overcast', 'rain', 'night', 'snow'].map(preset => (
                        <button
                            key={preset}
                            onClick={() => onPreset(preset)}
                            style={presetButtonStyle}
                        >
                            {preset.charAt(0).toUpperCase() + preset.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sliders */}
            <div style={{ padding: '15px', overflowY: 'auto', flex: 1 }}>
                <div style={{ marginBottom: '15px' }}>
                    <label style={labelStyle}>
                        Vibrance <span style={valueStyle}>{vibrance.toFixed(2)}</span>
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={vibrance}
                        onChange={(e) => onVibranceChange(parseFloat(e.target.value))}
                        style={sliderStyle}
                    />
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={labelStyle}>
                        Saturation <span style={valueStyle}>{saturation.toFixed(2)}</span>
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={saturation}
                        onChange={(e) => onSaturationChange(parseFloat(e.target.value))}
                        style={sliderStyle}
                    />
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={labelStyle}>
                        Contrast <span style={valueStyle}>{contrast.toFixed(2)}</span>
                    </label>
                    <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.01"
                        value={contrast}
                        onChange={(e) => onContrastChange(parseFloat(e.target.value))}
                        style={sliderStyle}
                    />
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={labelStyle}>
                        Exposure <span style={valueStyle}>{exposure.toFixed(2)}</span>
                    </label>
                    <input
                        type="range"
                        min="-2"
                        max="2"
                        step="0.01"
                        value={exposure}
                        onChange={(e) => onExposureChange(parseFloat(e.target.value))}
                        style={sliderStyle}
                    />
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={labelStyle}>
                        Temperature <span style={valueStyle}>{temperature.toFixed(2)}</span>
                    </label>
                    <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={temperature}
                        onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
                        style={sliderStyle}
                    />
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={labelStyle}>
                        Tint <span style={valueStyle}>{tint.toFixed(2)}</span>
                    </label>
                    <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={tint}
                        onChange={(e) => onTintChange(parseFloat(e.target.value))}
                        style={sliderStyle}
                    />
                </div>
            </div>
        </div>
    );
};

export default ColorGradingPanel;