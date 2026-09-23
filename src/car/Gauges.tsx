import React from 'react';
import styles from './Gauges.module.css';

// ============================================================================
// Type Definitions
// ============================================================================

export interface GearIndicatorProps {
  gear: 'P' | 'R' | 'N' | 'D' | '1' | '2' | '3' | string;
  size?: number;
  isActive?: boolean;
}

/** Compact digital readout — pairs with the 3D instrument cluster (no duplicate dials). */
export interface TelemetryChipProps {
  speedKmh: number;
  rpm: number;
  gear: string;
  nightGlow?: number;
}

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

/** Pure formatter shared by the compact chip — kept side-effect-free so it can be unit tested. */
export const formatRpm = (rpm: number): string => {
  if (rpm >= 1000) {
    const k = rpm / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  return String(Math.round(rpm));
};

export const getGearColor = (gear: string): string => {
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
// Default Export
// ============================================================================

const gauges = {
  GearIndicator,
  TelemetryChip,
};

export default gauges;
