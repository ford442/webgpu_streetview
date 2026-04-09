/**
 * DashboardLayout.tsx
 * 
 * Premium Car Dashboard - Glassmorphism UI Components
 * Zone-based layout for automotive HUD interface
 */

import React from 'react';

// ============================================================================
// Color Palette Constants
// ============================================================================

export const COLORS = {
  primary: '#00D4FF',
  secondary: '#FF3864',
  background: 'rgba(15, 20, 25, 0.6)',
  backgroundSolid: '#0F1419',
  textPrimary: 'rgba(255, 255, 255, 0.9)',
  textSecondary: 'rgba(255, 255, 255, 0.5)',
  textMuted: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.1)',
  borderHover: 'rgba(0, 212, 255, 0.3)',
  glow: 'rgba(0, 212, 255, 0.2)',
} as const;

// ============================================================================
// Glassmorphism Base Styles
// ============================================================================

export const glassmorphismBase: React.CSSProperties = {
  background: COLORS.background,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: `1px solid ${COLORS.border}`,
  borderRadius: '16px',
};

export const glassmorphismHover: React.CSSProperties = {
  ...glassmorphismBase,
  borderColor: COLORS.borderHover,
  boxShadow: `0 4px 24px ${COLORS.glow}`,
};

// ============================================================================
// Typography Styles
// ============================================================================

export const typography: Record<string, React.CSSProperties> = {
  label: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: COLORS.textMuted,
    fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  value: {
    fontSize: '24px',
    fontWeight: 500,
    color: COLORS.textPrimary,
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace",
  },
  valueLarge: {
    fontSize: '32px',
    fontWeight: 600,
    color: COLORS.textPrimary,
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace",
  },
  valueSmall: {
    fontSize: '16px',
    fontWeight: 500,
    color: COLORS.textPrimary,
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace",
  },
  unit: {
    fontSize: '12px',
    fontWeight: 400,
    color: COLORS.textSecondary,
    fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
    marginLeft: '4px',
  },
};

// ============================================================================
// Animation & Transition Styles
// ============================================================================

export const transitions = {
  default: 'all 0.2s ease',
  fast: 'all 0.15s ease',
  slow: 'all 0.3s ease',
} as const;

export const hoverEffect: React.CSSProperties = {
  transition: transitions.default,
  cursor: 'pointer',
};

export const hoverEffectActive: React.CSSProperties = {
  transform: 'translateY(-2px)',
  boxShadow: `0 4px 20px ${COLORS.glow}`,
};

// ============================================================================
// Dashboard Container Component
// ============================================================================

export interface DashboardContainerProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Main dashboard container with glassmorphism styling
 * Pinned to bottom of screen with three-zone grid layout
 */
export const DashboardContainer: React.FC<DashboardContainerProps> = ({
  children,
  style,
  className,
}) => {
  const containerStyle: React.CSSProperties = {
    // Positioning
    position: 'absolute',
    bottom: '20px',
    left: '20px',
    right: '20px',
    
    // Dimensions
    height: '200px',
    minHeight: '180px',
    maxHeight: '220px',
    
    // Layout
    display: 'grid',
    gridTemplateColumns: '1fr 1.5fr 1fr',
    gap: '16px',
    padding: '20px',
    boxSizing: 'border-box',
    
    // Glassmorphism
    ...glassmorphismBase,
    
    // Additional styling
    zIndex: 100,
    overflow: 'hidden',
    
    // Custom overrides
    ...style,
  };

  return (
    <div style={containerStyle} className={className}>
      {children}
    </div>
  );
};

// ============================================================================
// Zone Wrapper Components
// ============================================================================

export interface ZoneProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

const baseZoneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '12px',
  borderRadius: '12px',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

/**
 * Zone 1 (Left) - Driving HUD
 * Contains: Speed gauge, RPM gauge, Gear indicator
 */
export const ZoneLeft: React.FC<ZoneProps> = ({ children, style, className }) => {
  const zoneStyle: React.CSSProperties = {
    ...baseZoneStyle,
    background: 'rgba(0, 0, 0, 0.2)',
    border: `1px solid ${COLORS.border}`,
    ...style,
  };

  return (
    <div style={zoneStyle} className={className}>
      {children}
    </div>
  );
};

/**
 * Zone 2 (Center) - Media & Navigation
 * Contains: Radio controls, audio visualizer, map toggle, snapshot
 */
export const ZoneCenter: React.FC<ZoneProps> = ({ children, style, className }) => {
  const zoneStyle: React.CSSProperties = {
    ...baseZoneStyle,
    background: 'rgba(0, 0, 0, 0.15)',
    border: `1px solid ${COLORS.border}`,
    alignItems: 'center',
    justifyContent: 'center',
    ...style,
  };

  return (
    <div style={zoneStyle} className={className}>
      {children}
    </div>
  );
};

/**
 * Zone 3 (Right) - Environment Controls
 * Contains: Weather sliders, car controls (lights, roof, wipers)
 */
export const ZoneRight: React.FC<ZoneProps> = ({ children, style, className }) => {
  const zoneStyle: React.CSSProperties = {
    ...baseZoneStyle,
    background: 'rgba(0, 0, 0, 0.2)',
    border: `1px solid ${COLORS.border}`,
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gap: '8px',
    ...style,
  };

  return (
    <div style={zoneStyle} className={className}>
      {children}
    </div>
  );
};

// ============================================================================
// Helper Components
// ============================================================================

export interface GaugeProps {
  label: string;
  value: string | number;
  unit?: string;
  max?: number;
  color?: string;
  style?: React.CSSProperties;
}

/**
 * Circular/Semi-circular gauge display component
 */
export const Gauge: React.FC<GaugeProps> = ({
  label,
  value,
  unit,
  max = 100,
  color = COLORS.primary,
  style,
}) => {
  const gaugeStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    ...style,
  };

  const valueContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: '2px',
  };

  return (
    <div style={gaugeStyle}>
      <div style={valueContainerStyle}>
        <span style={{ ...typography.value, color }}>{value}</span>
        {unit && <span style={typography.unit}>{unit}</span>}
      </div>
      <span style={typography.label}>{label}</span>
    </div>
  );
};

export interface ControlButtonProps {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * Glassmorphism control button with hover effects
 */
export const ControlButton: React.FC<ControlButtonProps> = ({
  children,
  active = false,
  onClick,
  style,
}) => {
  const buttonStyle: React.CSSProperties = {
    ...glassmorphismBase,
    background: active ? 'rgba(0, 212, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
    borderColor: active ? COLORS.primary : COLORS.border,
    borderRadius: '12px',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    cursor: 'pointer',
    transition: transitions.default,
    color: active ? COLORS.primary : COLORS.textPrimary,
    ...style,
  };

  const [isHovered, setIsHovered] = React.useState(false);

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  const hoverStyle: React.CSSProperties = isHovered ? {
    transform: 'translateY(-2px)',
    borderColor: COLORS.primary,
    boxShadow: `0 4px 16px ${COLORS.glow}`,
  } : {};

  return (
    <button
      style={{ ...buttonStyle, ...hoverStyle }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </button>
  );
};

export interface SliderControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  style?: React.CSSProperties;
}

/**
 * Glassmorphism slider control with custom styling
 */
export const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  style,
}) => {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
    ...style,
  };

  const sliderContainerStyle: React.CSSProperties = {
    position: 'relative',
    height: '6px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '3px',
    overflow: 'hidden',
  };

  const fillStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    width: `${((value - min) / (max - min)) * 100}%`,
    background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primary}88)`,
    borderRadius: '3px',
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(parseFloat(e.target.value));
  };

  const inputStyle: React.CSSProperties = {
    position: 'absolute',
    top: '-6px',
    left: 0,
    width: '100%',
    height: '18px',
    opacity: 0,
    cursor: 'pointer',
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={typography.label}>{label}</span>
        <span style={typography.valueSmall}>{Math.round(value)}%</span>
      </div>
      <div style={sliderContainerStyle}>
        <div style={fillStyle} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          style={inputStyle}
        />
      </div>
    </div>
  );
};

// ============================================================================
// Section Header Component
// ============================================================================

export interface SectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Section header with icon and label styling
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  icon,
  style,
}) => {
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    paddingBottom: '8px',
    borderBottom: `1px solid ${COLORS.border}`,
    ...style,
  };

  return (
    <div style={headerStyle}>
      {icon && <span style={{ color: COLORS.primary, fontSize: '14px' }}>{icon}</span>}
      <span style={typography.label}>{title}</span>
    </div>
  );
};

// ============================================================================
// Status Indicator Component
// ============================================================================

export interface StatusIndicatorProps {
  label: string;
  active?: boolean;
  warning?: boolean;
  style?: React.CSSProperties;
}

/**
 * Status indicator light with label
 */
export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  label,
  active = false,
  warning = false,
  style,
}) => {
  const indicatorColor = warning ? COLORS.secondary : COLORS.primary;
  
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    ...style,
  };

  const lightStyle: React.CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: active ? indicatorColor : 'rgba(255, 255, 255, 0.2)',
    boxShadow: active ? `0 0 8px ${indicatorColor}` : 'none',
    transition: transitions.default,
  };

  return (
    <div style={containerStyle}>
      <div style={lightStyle} />
      <span style={{ ...typography.label, fontSize: '9px' }}>{label}</span>
    </div>
  );
};

// ============================================================================
// Divider Component
// ============================================================================

export const Divider: React.FC<{ vertical?: boolean; style?: React.CSSProperties }> = ({
  vertical = false,
  style,
}) => {
  const dividerStyle: React.CSSProperties = vertical ? {
    width: '1px',
    background: COLORS.border,
    margin: '0 8px',
    ...style,
  } : {
    height: '1px',
    background: COLORS.border,
    margin: '8px 0',
    ...style,
  };

  return <div style={dividerStyle} />;
};

// ============================================================================
// Default Export
// ============================================================================

export default {
  DashboardContainer,
  ZoneLeft,
  ZoneCenter,
  ZoneRight,
  Gauge,
  ControlButton,
  SliderControl,
  SectionHeader,
  StatusIndicator,
  Divider,
  COLORS,
  typography,
  glassmorphismBase,
  transitions,
};
