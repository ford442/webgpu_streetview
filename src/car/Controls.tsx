import React, { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// ICON SVG PATHS (Automotive Interface Icons)
// ============================================================================

export const GPS_ICON = 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z';
export const RADIO_ICON = 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z';
export const ROOF_ICON = 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z';
export const WIPER_ICON = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z';
export const HEADLIGHT_ICON = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z';
export const HIGHBEAM_ICON = 'M6 13h12c.55 0 1-.45 1-1V7c0-.55-.45-1-1-1H6c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1zm.5-5h11v4h-11V8zm13.5 8H4c-.55 0-1 .45-1 1s.45 1 1 1h16c.55 0 1-.45 1-1s-.45-1-1-1z';
export const DOME_ICON = 'M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z';
export const SNOW_ICON = 'M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2zm0 0';
export const RAIN_ICON = 'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm.5 19.2c-3.5 0-6.5-2.42-6.5-7.4 0-2.55 1.83-5.42 6.5-9.44 4.67 4.02 6.5 6.89 6.5 9.44 0 4.98-3 7.4-6.5 7.4z';
export const WIND_ICON = 'M12.5 2.5c-1.5 0-2.7 1.2-2.7 2.7s1.2 2.7 2.7 2.7h3c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5H6.5c-1.4 0-2.5 1.1-2.5 2.5s1.1 2.5 2.5 2.5h9c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3';
export const VEHICLE_ICON = 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z';
export const TINT_ICON = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z';

// Additional useful icons
export const VOLUME_ICON = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
export const POWER_ICON = 'M16.56 13.66a8 8 0 0 1-11.32 0L7.3 11.6a5.33 5.33 0 0 0 7.54 0l1.72 2.06zM13.5 5.5v6h-3v-6h3z';
export const FAN_ICON = 'M12 12c0-3 2.5-5.5 5.5-5.5S23 9 23 12H12zm0 0c0 3-2.5 5.5-5.5 5.5S1 15 1 12h11zm0 0c-3 0-5.5-2.5-5.5-5.5S9 1 12 1v11zm0 0c3 0 5.5 2.5 5.5 5.5S15 23 12 23V12z';
export const TEMP_ICON = 'M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-2V5c0-.55.45-1 1-1s1 .45 1 1v1h-1v1h1v2h-1v1h1v1h-2z';

// ============================================================================
// TYPES
// ============================================================================

export interface IconButtonProps {
  icon: string;
  label?: string;
  active?: boolean;
  activeColor?: string;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel: string;
}

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label: string;
  icon?: string;
  color?: string;
}

export interface ToggleGroupProps {
  options: Array<{
    value: string;
    icon: string;
    label: string;
  }>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

export interface AudioVisualizerProps {
  analyser?: AnalyserNode | null;
  isActive?: boolean;
  barCount?: number;
  width?: number;
  height?: number;
}

// ============================================================================
// ICON BUTTON COMPONENT
// ============================================================================

const SIZE_MAP = {
  sm: { padding: '8px', iconSize: 20 },
  md: { padding: '12px', iconSize: 24 },
  lg: { padding: '16px', iconSize: 32 },
};

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  active = false,
  activeColor = '#00D4FF',
  onClick,
  size = 'md',
  ariaLabel,
}) => {
  const sizeConfig = SIZE_MAP[size];

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    padding: sizeConfig.padding,
    background: active
      ? `${activeColor}26`
      : 'rgba(255, 255, 255, 0.05)',
    border: `1px solid ${active ? activeColor : 'rgba(255, 255, 255, 0.1)'}`,
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: active
      ? `0 0 20px ${activeColor}4D, inset 0 0 10px ${activeColor}1A`
      : 'none',
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const target = e.currentTarget;
    target.style.background = active
      ? `${activeColor}33`
      : 'rgba(255, 255, 255, 0.1)';
    target.style.transform = 'translateY(-2px)';
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const target = e.currentTarget;
    target.style.background = active
      ? `${activeColor}26`
      : 'rgba(255, 255, 255, 0.05)';
    target.style.transform = 'translateY(0)';
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label={ariaLabel}
      aria-pressed={active}
      style={buttonStyle}
    >
      <svg
        width={sizeConfig.iconSize}
        height={sizeConfig.iconSize}
        viewBox="0 0 24 24"
        fill={active ? activeColor : 'rgba(255, 255, 255, 0.7)'}
        style={{ transition: 'fill 0.2s ease' }}
      >
        <path d={icon} />
      </svg>
      {label && (
        <span
          style={{
            fontSize: size === 'sm' ? '10px' : '11px',
            color: active ? activeColor : 'rgba(255, 255, 255, 0.7)',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            transition: 'color 0.2s ease',
          }}
        >
          {label}
        </span>
      )}
    </button>
  );
};

// ============================================================================
// SLIDER COMPONENT
// ============================================================================

export const Slider: React.FC<SliderProps> = ({
  value,
  min = 0,
  max = 100,
  onChange,
  label,
  icon,
  color = '#00D4FF',
}) => {
  const percentage = ((value - min) / (max - min)) * 100;

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  };

  const labelRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: 500,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    flex: 1,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: '11px',
    color: color,
    fontWeight: 600,
    fontFamily: 'monospace',
  };

  const sliderContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    WebkitAppearance: 'none',
    appearance: 'none',
    height: '4px',
    background: `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, rgba(255, 255, 255, 0.1) ${percentage}%, rgba(255, 255, 255, 0.1) 100%)`,
    borderRadius: '2px',
    cursor: 'pointer',
    outline: 'none',
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  return (
    <div style={containerStyle}>
      <div style={labelRowStyle}>
        {icon && (
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="rgba(255, 255, 255, 0.5)"
          >
            <path d={icon} />
          </svg>
        )}
        <span style={labelStyle}>{label}</span>
        <span style={valueStyle}>{value}</span>
      </div>
      <div style={sliderContainerStyle}>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={handleChange}
          aria-label={label}
          style={inputStyle}
        />
      </div>
    </div>
  );
};

// ============================================================================
// TOGGLE GROUP COMPONENT
// ============================================================================

export const ToggleGroup: React.FC<ToggleGroupProps> = ({
  options,
  value,
  onChange,
  ariaLabel,
}) => {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '4px',
    padding: '4px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} style={containerStyle}>
      {options.map((option) => {
        const isSelected = option.value === value;

        const buttonStyle: React.CSSProperties = {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          padding: '8px 12px',
          background: isSelected
            ? 'rgba(0, 212, 255, 0.2)'
            : 'transparent',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        };

        const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
          if (!isSelected) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          }
        };

        const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
          if (!isSelected) {
            e.currentTarget.style.background = 'transparent';
          }
        };

        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={buttonStyle}
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill={isSelected ? '#00D4FF' : 'rgba(255, 255, 255, 0.5)'}
              style={{ transition: 'fill 0.2s ease' }}
            >
              <path d={option.icon} />
            </svg>
            <span
              style={{
                fontSize: '11px',
                color: isSelected ? '#00D4FF' : 'rgba(255, 255, 255, 0.5)',
                fontWeight: isSelected ? 600 : 500,
                letterSpacing: '0.5px',
                transition: 'color 0.2s ease',
              }}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// ============================================================================
// AUDIO VISUALIZER COMPONENT
// ============================================================================

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  analyser,
  isActive = true,
  barCount = 20,
  width = 200,
  height = 40,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (!isActive || !analyser) {
      // Draw idle state - flat line
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      const barWidth = (width / barCount) - 2;
      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + 2);
        const barHeight = 2;
        const y = height - barHeight;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    // Initialize data array if needed
    if (!dataArrayRef.current) {
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    }

    // Get frequency data
    analyser.getByteFrequencyData(dataArrayRef.current);

    const dataArray = dataArrayRef.current;
    const step = Math.floor(dataArray.length / barCount);
    const barWidth = (width / barCount) - 2;

    for (let i = 0; i < barCount; i++) {
      const dataIndex = i * step;
      const value = dataArray[dataIndex] || 0;
      const normalizedValue = value / 255;
      
      // Calculate bar height with smooth scaling
      const maxBarHeight = height - 4;
      const barHeight = Math.max(2, normalizedValue * maxBarHeight);
      const x = i * (barWidth + 2);
      const y = height - barHeight;

      // Create gradient for this bar
      const gradient = ctx.createLinearGradient(0, height, 0, y);
      gradient.addColorStop(0, '#0099CC');
      gradient.addColorStop(1, '#00D4FF');

      ctx.fillStyle = gradient;
      
      // Draw rounded bar
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 3);
      ctx.fill();

      // Add glow effect for active bars
      if (normalizedValue > 0.3) {
        ctx.shadowColor = '#00D4FF';
        ctx.shadowBlur = 10 * normalizedValue;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    animationRef.current = requestAnimationFrame(draw);
  }, [analyser, isActive, barCount, width, height]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        borderRadius: '4px',
        background: 'rgba(0, 0, 0, 0.3)',
      }}
      aria-label="Audio visualizer"
    />
  );
};

// ============================================================================
// STYLES (CSS-in-JS for slider pseudo-elements)
// ============================================================================

export const injectSliderStyles = (): void => {
  const styleId = 'car-controls-slider-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #00D4FF;
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.9);
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: -6px;
    }

    input[type="range"]::-webkit-slider-thumb:hover {
      transform: scale(1.1);
      box-shadow: 0 0 15px rgba(0, 212, 255, 0.7);
    }

    input[type="range"]::-webkit-slider-thumb:active {
      box-shadow: 0 0 0 4px rgba(0, 212, 255, 0.2), 0 0 15px rgba(0, 212, 255, 0.7);
    }

    input[type="range"]::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #00D4FF;
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.9);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    input[type="range"]::-moz-range-thumb:hover {
      transform: scale(1.1);
      box-shadow: 0 0 15px rgba(0, 212, 255, 0.7);
    }

    input[type="range"]::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 2px;
    }

    input[type="range"]::-moz-range-track {
      height: 4px;
      border-radius: 2px;
    }

    input[type="range"]:focus {
      outline: none;
    }

    input[type="range"]:focus::-webkit-slider-thumb {
      box-shadow: 0 0 0 4px rgba(0, 212, 255, 0.2), 0 0 15px rgba(0, 212, 255, 0.7);
    }
  `;
  document.head.appendChild(style);
};

// ============================================================================
// CONTROL PANEL WRAPPER COMPONENT
// ============================================================================

export interface ControlPanelProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  children,
  title,
  className,
  style,
}) => {
  const panelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    background: 'rgba(20, 20, 30, 0.8)',
    backdropFilter: 'blur(12px)',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
    ...style,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    margin: 0,
    paddingBottom: '8px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  };

  return (
    <div className={className} style={panelStyle}>
      {title && <h3 style={titleStyle}>{title}</h3>}
      {children}
    </div>
  );
};

// ============================================================================
// BUTTON ROW COMPONENT
// ============================================================================

export interface ButtonRowProps {
  children: React.ReactNode;
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between';
  gap?: number;
}

export const ButtonRow: React.FC<ButtonRowProps> = ({
  children,
  justify = 'flex-start',
  gap = 8,
}) => {
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: justify,
    gap: `${gap}px`,
    flexWrap: 'wrap',
  };

  return <div style={rowStyle}>{children}</div>;
};

// ============================================================================
// DIVIDER COMPONENT
// ============================================================================

export const Divider: React.FC = () => {
  const dividerStyle: React.CSSProperties = {
    height: '1px',
    background: 'linear-gradient(to right, transparent, rgba(255, 255, 255, 0.2), transparent)',
    margin: '8px 0',
  };

  return <div style={dividerStyle} />;
};

// Default export for convenience
export default {
  IconButton,
  Slider,
  ToggleGroup,
  AudioVisualizer,
  ControlPanel,
  ButtonRow,
  Divider,
  injectSliderStyles,
};
