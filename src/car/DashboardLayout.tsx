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

const Value: React.FC<React.PropsWithChildren<{ large?: boolean; className?: string; style?: React.CSSProperties }>> = ({
  children,
  large,
  className,
  style,
}) => <span className={`${large ? styles.valueLarge : styles.value} ${className ?? ''}`} style={style}>{children}</span>;

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

// ============================================================================
// Status Indicator
// ============================================================================

// ============================================================================
// Divider
// ============================================================================

// ============================================================================
// Gauge display (simple numeric read-out)
// ============================================================================

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

