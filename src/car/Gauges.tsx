import React, { useEffect, useRef, useState, useMemo } from 'react';
import styles from './Gauges.module.css';

// ============================================================================
// Type Definitions
// ============================================================================

export interface CircularGaugeProps {
  value: number;
  min?: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label: string;
  unit?: string;
  segments?: number;
  startAngle?: number;
  arcSweep?: number;
  useGradient?: boolean;
  warningThreshold?: number;
  stiffness?: number;
  damping?: number;
  nightGlow?: number;
}

export interface SpeedGaugeProps {
  value: number;
  size?: number;
  unit?: 'MPH' | 'KPH';
  nightGlow?: number;
}

export interface RpmGaugeProps {
  value: number;
  size?: number;
  maxRpm?: number;
  redline?: number;
  nightGlow?: number;
}

export interface GearIndicatorProps {
  gear: 'P' | 'R' | 'N' | 'D' | '1' | '2' | '3' | string;
  size?: number;
  isActive?: boolean;
}

export interface GaugeDashboardProps {
  speed: number;
  rpm: number;
  gear: string;
  size?: 'small' | 'medium' | 'large';
  unit?: 'MPH' | 'KPH';
}

/** Compact digital readout — pairs with the 3D instrument cluster (no duplicate dials). */
export interface TelemetryChipProps {
  speedKmh: number;
  rpm: number;
  gear: string;
  nightGlow?: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

const polarToCartesian = (
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
): { x: number; y: number } => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
};

const describeArc = (
  x: number,
  y: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string => {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    'M',
    start.x,
    start.y,
    'A',
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
  ].join(' ');
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const interpolateColor = (
  color1: string,
  color2: string,
  factor: number
): string => {
  const hex2rgb = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  };

  const rgb2hex = (r: number, g: number, b: number): string =>
    `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;

  const c1 = hex2rgb(color1);
  const c2 = hex2rgb(color2);

  const r = Math.round(c1[0] + (c2[0] - c1[0]) * factor);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * factor);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * factor);

  return rgb2hex(r, g, b);
};

// ============================================================================
// Spring-Physics Animated Values
// ============================================================================

const useSpringValue = (
  targetValue: number,
  stiffness: number = 150,
  damping: number = 16
): number => {
  const posRef = useRef(targetValue);
  const velRef = useRef(0);
  const [displayValue, setDisplayValue] = useState(targetValue);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const reducedMotion = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ).current;

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    if (reducedMotion) {
      setDisplayValue(targetValue);
      posRef.current = targetValue;
      velRef.current = 0;
      return;
    }

    lastTimeRef.current = performance.now();

    const step = (now: number) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;

      const acc =
        -stiffness * (posRef.current - targetValue) - damping * velRef.current;
      velRef.current += acc * dt;
      posRef.current += velRef.current * dt;

      setDisplayValue(posRef.current);

      if (
        Math.abs(velRef.current) > 0.01 ||
        Math.abs(posRef.current - targetValue) > 0.05
      ) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        posRef.current = targetValue;
        velRef.current = 0;
        setDisplayValue(targetValue);
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [targetValue, stiffness, damping, reducedMotion]);

  return displayValue;
};

// ============================================================================
// CircularGauge Component
// ============================================================================

export const CircularGauge: React.FC<CircularGaugeProps> = ({
  value,
  min = 0,
  max,
  size = 200,
  strokeWidth = 8,
  color = '#00D4FF',
  label,
  unit = '',
  segments = 40,
  startAngle = 120,
  arcSweep = 240,
  useGradient = false,
  warningThreshold,
  stiffness = 150,
  damping = 16,
  nightGlow = 0,
}) => {
  const animatedValue = useSpringValue(clamp(value, min, max), stiffness, damping);

  const center = 50;
  const radius = 40;
  const endAngle = startAngle + arcSweep;
  const normalizedValue = (animatedValue - min) / (max - min);
  const currentAngle = startAngle + normalizedValue * arcSweep;

  const ticks = useMemo(() => {
    const arr: React.ReactElement[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * arcSweep;
      const isMajor = i % 5 === 0;
      const innerRadius = radius - (isMajor ? 6 : 3);
      const outerRadius = radius + (isMajor ? 2 : 1);

      const start = polarToCartesian(center, center, innerRadius, angle);
      const end = polarToCartesian(center, center, outerRadius, angle);

      let tickColor = 'rgba(255, 255, 255, 0.4)';
      if (warningThreshold !== undefined) {
        const tickValue = min + (i / segments) * (max - min);
        if (tickValue >= warningThreshold) {
          tickColor = 'rgba(255, 56, 100, 0.6)';
        }
      }

      arr.push(
        <line
          key={i}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={tickColor}
          strokeWidth={isMajor ? 1.5 : 0.8}
          strokeLinecap="round"
        />
      );
    }
    return arr;
  }, [segments, startAngle, arcSweep, center, radius, warningThreshold, min, max]);

  const progressColor = useMemo(() => {
    if (!useGradient) return color;

    if (warningThreshold !== undefined && animatedValue >= warningThreshold) {
      const warningRange = max - warningThreshold;
      const warningProgress = (animatedValue - warningThreshold) / warningRange;
      return interpolateColor('#00D4FF', '#FF3864', Math.min(warningProgress * 2, 1));
    }

    if (warningThreshold !== undefined) {
      const safeProgress = animatedValue / warningThreshold;
      return interpolateColor('#00D4FF', '#0099CC', safeProgress);
    }

    return interpolateColor('#00D4FF', '#0099CC', normalizedValue);
  }, [useGradient, warningThreshold, animatedValue, max, normalizedValue, color]);

  const textShadow =
    nightGlow > 0.3
      ? `0 0 ${8 + nightGlow * 16}px var(--ambient-glow, rgba(70, 210, 130, 0.4))`
      : 'none';

  return (
    <div
      className={styles.gaugeWrapper}
      style={{ width: size, height: size * 1.15 }}
    >
      <svg
        className={styles.gaugeSvg}
        viewBox="0 0 100 100"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${label}: ${Math.round(animatedValue)} ${unit}`}
      >
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00D4FF" />
            <stop offset="100%" stopColor="#0099CC" />
          </linearGradient>
          <filter id="gaugeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d={describeArc(center, center, radius, startAngle, endAngle)}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        <g>{ticks}</g>

        <path
          d={describeArc(center, center, radius, startAngle, currentAngle)}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{
            filter: 'drop-shadow(0 0 4px currentColor)',
            transition: 'stroke 0.1s ease-out',
          }}
        />

        <circle
          cx={center}
          cy={center}
          r={radius - 12}
          fill="none"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth={1}
        />
      </svg>

      <div className={styles.digitalReadout}>
        <span
          className={styles.gaugeValue}
          style={{ fontSize: size * 0.24, textShadow }}
        >
          {Math.round(animatedValue).toString().padStart(3, '0')}
        </span>
        {unit && (
          <span
            className={styles.gaugeUnit}
            style={{ fontSize: size * 0.08, marginTop: size * 0.02 }}
          >
            {unit}
          </span>
        )}
      </div>

      <span
        className={styles.gaugeLabel}
        style={{ fontSize: size * 0.09, marginTop: size * 0.08 }}
      >
        {label}
      </span>
    </div>
  );
};

// ============================================================================
// SpeedGauge Component
// ============================================================================

export const SpeedGauge: React.FC<SpeedGaugeProps> = ({
  value,
  size = 200,
  unit = 'MPH',
  nightGlow = 0,
}) => {
  const maxSpeed = unit === 'MPH' ? 200 : 300;

  return (
    <CircularGauge
      value={value}
      min={0}
      max={maxSpeed}
      size={size}
      strokeWidth={6}
      color="#00D4FF"
      label="Speed"
      unit={unit}
      segments={50}
      startAngle={120}
      arcSweep={240}
      useGradient={true}
      stiffness={120}
      damping={14}
      nightGlow={nightGlow}
    />
  );
};

// ============================================================================
// RpmGauge Component
// ============================================================================

export const RpmGauge: React.FC<RpmGaugeProps> = ({
  value,
  size = 200,
  maxRpm = 8000,
  redline = 6500,
  nightGlow = 0,
}) => {
  return (
    <CircularGauge
      value={value}
      min={0}
      max={maxRpm}
      size={size}
      strokeWidth={6}
      color="#00D4FF"
      label="RPM"
      unit="×1000"
      segments={40}
      startAngle={120}
      arcSweep={240}
      useGradient={true}
      warningThreshold={redline}
      stiffness={200}
      damping={18}
      nightGlow={nightGlow}
    />
  );
};

// ============================================================================
// GearIndicator Component
// ============================================================================

export const GearIndicator: React.FC<GearIndicatorProps> = ({
  gear,
  size = 48,
  isActive = true,
}) => {
  const validGears = ['P', 'R', 'N', 'D', '1', '2', '3'];
  const displayGear = validGears.includes(gear.toUpperCase()) ? gear.toUpperCase() : gear;

  const getGearColor = (): string => {
    switch (displayGear) {
      case 'P':
        return '#4CAF50';
      case 'R':
        return '#FF3864';
      case 'N':
        return '#FFC107';
      case 'D':
        return '#00D4FF';
      default:
        return '#00D4FF';
    }
  };

  const gearColor = getGearColor();

  return (
    <div
      className={styles.gearWrapper}
      style={{ width: size * 1.5, height: size * 1.5 }}
    >
      <div
        className={styles.gearBox}
        style={{
          width: size * 1.25,
          height: size * 1.25,
          borderRadius: size * 0.2,
          border: `2px solid ${isActive ? gearColor : 'rgba(255, 255, 255, 0.2)'}`,
          boxShadow: isActive
            ? `0 0 ${size * 0.25}px ${gearColor}40, inset 0 0 ${size * 0.15}px ${gearColor}20`
            : 'none',
        }}
      >
        <span
          className={styles.gearText}
          style={{
            fontSize: size * 0.7,
            color: isActive ? gearColor : 'rgba(255, 255, 255, 0.4)',
            textShadow: isActive ? `0 0 ${size * 0.15}px ${gearColor}` : 'none',
          }}
        >
          {displayGear}
        </span>
      </div>
      <span
        className={styles.gearLabel}
        style={{ fontSize: size * 0.2, marginTop: size * 0.15 }}
      >
        Gear
      </span>
    </div>
  );
};

// ============================================================================
// TelemetryChip — compact HUD readout (3D cluster is canonical)
// ============================================================================

const formatRpm = (rpm: number): string => {
  if (rpm >= 1000) {
    const k = rpm / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  return String(Math.round(rpm));
};

const getGearColor = (gear: string): string => {
  switch (gear.toUpperCase()) {
    case 'P':
      return '#4CAF50';
    case 'R':
      return '#FF3864';
    case 'N':
      return '#FFC107';
    case 'D':
      return '#4CAF50';
    default:
      return '#4CAF50';
  }
};

export const TelemetryChip: React.FC<TelemetryChipProps> = ({
  speedKmh,
  rpm,
  gear,
  nightGlow = 0,
}) => {
  const displayGear = gear.toUpperCase();
  const gearColor = getGearColor(displayGear);
  const speedRounded = Math.round(speedKmh);
  const rpmLabel = formatRpm(rpm);
  const glow =
    nightGlow > 0.3
      ? `0 0 ${8 + nightGlow * 12}px var(--ambient-glow, rgba(70, 210, 130, 0.35))`
      : 'none';

  return (
    <div
      className={styles.telemetryChip}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Speed ${speedRounded} kilometres per hour, gear ${displayGear}, engine ${Math.round(rpm)} RPM`}
    >
      <div className={styles.telemetryPrimary}>
        <span className={styles.telemetrySpeed} style={{ textShadow: glow }}>
          {speedRounded}
        </span>
        <span className={styles.telemetryUnit}>km/h</span>
      </div>
      <div className={styles.telemetrySecondary}>
        <span
          className={styles.telemetryGear}
          style={{ color: gearColor, textShadow: `0 0 8px ${gearColor}66` }}
        >
          {displayGear}
        </span>
        <span className={styles.telemetryDivider} aria-hidden="true" />
        <span className={styles.telemetryRpm}>{rpmLabel} RPM</span>
      </div>
    </div>
  );
};

// ============================================================================
// Combined Dashboard Component
// ============================================================================

export const GaugeDashboard: React.FC<GaugeDashboardProps> = ({
  speed,
  rpm,
  gear,
  size = 'medium',
  unit = 'MPH',
}) => {
  const sizes = {
    small: { gauge: 140, gear: 36 },
    medium: { gauge: 180, gear: 44 },
    large: { gauge: 240, gear: 56 },
  };

  const { gauge: gaugeSize, gear: gearSize } = sizes[size];

  return (
    <div
      className={styles.gaugeDashboard}
      style={{ gap: gaugeSize * 0.2 }}
    >
      <RpmGauge value={rpm} size={gaugeSize} />
      <GearIndicator gear={gear} size={gearSize} />
      <SpeedGauge value={speed} size={gaugeSize} unit={unit} />
    </div>
  );
};

// ============================================================================
// Default Export
// ============================================================================

const gauges = {
  CircularGauge,
  SpeedGauge,
  RpmGauge,
  GearIndicator,
  TelemetryChip,
  GaugeDashboard,
};

export default gauges;
