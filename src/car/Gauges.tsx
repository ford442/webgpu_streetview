import React from 'react';
import styles from './Gauges.module.css';

// ============================================================================
// Type Definitions
// ============================================================================

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
    nightGlow > 0.45
      ? `0 0 ${3 + nightGlow * 5}px var(--ambient-glow, rgba(76, 175, 80, 0.35))`
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

