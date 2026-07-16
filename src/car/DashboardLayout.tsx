/**
 * DashboardLayout.tsx
 *
 * Premium Car Dashboard – Layout Primitives
 * Refactored to use CSS Modules + CSS custom properties.
 * All visual styling lives in DashboardLayout.module.css;
 * this file contains only component structure and event handling.
 */

import React from 'react';
import styles from './DashboardLayout.module.css';

// ============================================================================
// Re‑export the static theme object for convenience
// ============================================================================

export const theme = {
  '--color-primary': '#00D4FF',
  '--color-secondary': '#FF3864',
  '--color-bg-glass': 'rgba(15,20,25,0.6)',
  '--color-bg-solid': '#0F1419',
  '--color-text-primary': 'rgba(255,255,255,0.9)',
  '--color-text-muted': 'rgba(255,255,255,0.6)',
  '--color-border': 'rgba(255,255,255,0.1)',
  '--color-border-hover': 'rgba(0,212,255,0.3)',
  '--color-glow': 'rgba(0,212,255,0.2)',
  '--ambient-glow': 'rgba(0,212,255,0.45)',
  '--night-intensity': '0',
} as const;

export type Theme = typeof theme;

// ============================================================================
// Dashboard Container
// ============================================================================

export interface DashboardContainerProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const DashboardContainer: React.FC<DashboardContainerProps> = ({
  children,
  style,
  className,
}) => (
  <div
    className={`${styles.dashboard} ${styles.container} ${className ?? ''}`}
    style={style}
  >
    {children}
  </div>
);

// ============================================================================
// Zones
// ============================================================================

export interface ZoneProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const ZoneLeft: React.FC<ZoneProps> = ({ children, style, className }) => (
  <div className={`${styles.zoneLeft} ${className ?? ''}`} style={style}>
    {children}
  </div>
);

export const ZoneCenter: React.FC<ZoneProps> = ({ children, style, className }) => (
  <div className={`${styles.zoneCenter} ${className ?? ''}`} style={style}>
    {children}
  </div>
);

export const ZoneRight: React.FC<ZoneProps> = ({ children, style, className }) => (
  <div className={`${styles.zoneRight} ${className ?? ''}`} style={style}>
    {children}
  </div>
);

// ============================================================================
// Typography helpers
// ============================================================================

export const Label: React.FC<React.PropsWithChildren<{ className?: string }>> = ({
  children,
  className,
}) => <span className={`${styles.label} ${className ?? ''}`}>{children}</span>;

export const Value: React.FC<React.PropsWithChildren<{ large?: boolean; className?: string; style?: React.CSSProperties }>> = ({
  children,
  large,
  className,
  style,
}) => <span className={`${large ? styles.valueLarge : styles.value} ${className ?? ''}`} style={style}>{children}</span>;

export const Unit: React.FC<React.PropsWithChildren<{ className?: string }>> = ({
  children,
  className,
}) => <span className={`${styles.unit} ${className ?? ''}`}>{children}</span>;

// ============================================================================
// Control Button
// ============================================================================

export interface ControlButtonProps {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const ControlButton: React.FC<ControlButtonProps> = ({
  children,
  active = false,
  onClick,
  ariaLabel,
  className,
  style,
}) => (
  <button
    className={`${active ? styles.controlBtnActive : styles.controlBtn} ${className ?? ''}`}
    onClick={onClick}
    aria-label={ariaLabel}
    aria-pressed={active}
    style={style}
  >
    {children}
  </button>
);

// ============================================================================
// Slider Control
// ============================================================================

export interface SliderControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  className?: string;
}

export const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  className,
}) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={`${styles.sliderControl} ${className ?? ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>{label}</Label>
        <Value>{Math.round(value)}</Value>
      </div>
      <div className={styles.sliderTrackWrap}>
        <div className={styles.sliderFill} style={{ width: `${percentage}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(parseFloat(e.target.value))}
          aria-label={label}
          className={styles.sliderInput}
        />
      </div>
    </div>
  );
};

// ============================================================================
// Section Header
// ============================================================================

export interface SectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, icon, className }) => (
  <div className={`${styles.sectionHeader} ${className ?? ''}`}>
    {icon && <span style={{ color: 'var(--color-primary)', fontSize: '14px' }}>{icon}</span>}
    <Label>{title}</Label>
  </div>
);

// ============================================================================
// Status Indicator
// ============================================================================

export interface StatusIndicatorProps {
  label: string;
  active?: boolean;
  warning?: boolean;
  className?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  label,
  active = false,
  warning = false,
  className,
}) => (
  <div className={`${styles.statusIndicator} ${className ?? ''}`}>
    <div
      className={
        warning
          ? styles.statusDotWarning
          : active
          ? styles.statusDotActive
          : styles.statusDot
      }
    />
    <Label>{label}</Label>
  </div>
);

// ============================================================================
// Divider
// ============================================================================

export const Divider: React.FC<{ vertical?: boolean; className?: string }> = ({
  vertical = false,
  className,
}) => <div className={`${vertical ? styles.dividerVertical : styles.divider} ${className ?? ''}`} />;

// ============================================================================
// Gauge display (simple numeric read-out)
// ============================================================================

export interface GaugeProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  className?: string;
}

export const Gauge: React.FC<GaugeProps> = ({ label, value, unit, color, className }) => (
  <div className={className} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
      <Value style={color ? { color } : undefined}>{value}</Value>
      {unit && <Unit>{unit}</Unit>}
    </div>
    <Label>{label}</Label>
  </div>
);

/** Legacy colour constant object for backward compatibility */
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
};

// ============================================================================
// Button Row helper
// ============================================================================

export const ButtonRow: React.FC<React.PropsWithChildren<{ className?: string; gap?: number }>> = ({
  children,
  className,
  gap = 8,
}) => (
  <div
    className={className}
    style={{ display: 'flex', alignItems: 'center', gap: `${gap}px`, flexWrap: 'wrap' }}
  >
    {children}
  </div>
);

// ============================================================================
// Default export
// ============================================================================

const dashboardLayout = {
  DashboardContainer,
  ZoneLeft,
  ZoneCenter,
  ZoneRight,
  ControlButton,
  SliderControl,
  SectionHeader,
  StatusIndicator,
  Divider,
  Label,
  Value,
  Unit,
  Gauge,
  ButtonRow,
  theme,
};

export default dashboardLayout;
