/**
 * DashboardUI.tsx
 *
 * Premium Car Dashboard – Main Integration Component
 * Refactored to use CSS Modules + CSS custom properties for theming.
 * Layout primitives are imported from DashboardLayout; this file contains
 * only dashboard-specific composition, logic, and event handling.
 */

import React, { useCallback, useState } from 'react';
import styles from './DashboardUI.module.css';
import { darkTheme, applyTheme, clusterAmbientGlow } from './theme';

// Layout primitives
import {
  DashboardContainer,
  ZoneLeft,
  ZoneCenter,
  ZoneRight,
  ControlButton,
  SliderControl,
  ButtonRow,
  Label,
} from './DashboardLayout';

// Gauge components
import { TelemetryChip } from './Gauges';

// Icons + audio visualizer
import {
  AudioVisualizer,
  GPS_ICON,
  RADIO_ICON,
  ROOF_ICON,
  WIPER_ICON,
  HEADLIGHT_ICON,
  HIGHBEAM_ICON,
  DOME_ICON,
  VEHICLE_ICON,
  REAR_MIRROR_ICON,
} from './Controls';

// ============================================================================
// Interface Definition
// ============================================================================

export interface DashboardUIProps {
  isVisible: boolean;
  hudMode?: 'full' | 'compact' | 'immersive';
  isRadioPlaying: boolean;
  isMapOpen?: boolean;
  onNavigate?: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
  onToggleGPS: () => void;
  onToggleRadio: () => void;
  onRainIntensity: (value: number) => void;
  onSnowIntensity?: (value: number) => void;
  onWind?: (value: number) => void;
  onTimeOfDay: (value: string) => void;
  onToggleRoof: () => void;
  onToggleWipers?: () => void;
  onToggleVehicle?: () => void;
  onToggleHeadlights?: () => void;
  onToggleHighBeam?: () => void;
  onToggleDomeLight?: () => void;
  /** Toggle the billable rear-view Static imagery feed. Omit to hide the row. */
  onToggleRearFeed?: () => void;
  onWindowTint?: (value: number) => void;
  onSeatDistance?: (value: number) => void;
  isRoofOpen: boolean;
  wipersEnabled?: boolean;
  headlightsOn?: boolean;
  highBeam?: boolean;
  domeLightOn?: boolean;
  /** Whether the rear-view Static imagery feed is opted in. */
  rearFeedEnabled?: boolean;
  /** Human-readable feed state (off / paused / request count) for the row. */
  rearFeedStatus?: string;
  currentVehicle?: 'sedan' | 'convertible' | 'science-lab' | 'limousine';
  rainIntensity: number;
  snowIntensity?: number;
  wind?: number;
  windowTint?: number;
  /** Driver seat pullback distance (metres) off the dashboard. */
  seatDistance?: number;
  /** Upper bound for the seat-distance slider. */
  maxSeatDistance?: number;
  timeOfDay: string;
  audioElement?: HTMLAudioElement | null;
  analyser?: AnalyserNode | null;
  /** 0–1 night intensity — drives gauge bloom and ambient panel tint. */
  nightIntensity?: number;
  /** CSS rgba string from useEnvironmentSettings for dashboard glass tinting. */
  ambientLightColor?: string;
  /** Name of the currently tuned radio station */
  stationName?: string;
  /** Comma-separated genre tags for the current station */
  stationTags?: string;
  /** Live vehicle speed in km/h; when provided, replaces the demo simulation. */
  speedKmh?: number;
  /** Live engine RPM; when provided, replaces the demo simulation. */
  rpm?: number;
  /** Live gear indicator (P/R/N/D/1-3); when provided, replaces the demo simulation. */
  gear?: string;
}

// ============================================================================
// Icon helper
// ============================================================================

const IconSvg: React.FC<{
  path: string;
  size?: number;
  fill?: string;
}> = ({ path, size = 24, fill = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-hidden="true">
    <path d={path} />
  </svg>
);

// ============================================================================
// Direction Pad
// ============================================================================

const NAV_ARROW_FORWARD = 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z';
const NAV_ARROW_BACK = 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.58L4 12l8 8 8-8z';
const NAV_ARROW_LEFT = 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z';
const NAV_ARROW_RIGHT = 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z';

type Dir = 'forward' | 'backward' | 'left' | 'right';

interface DirectionPadProps {
  onNavigate: (dir: Dir) => void;
}

const DirectionPad: React.FC<DirectionPadProps> = ({ onNavigate }) => {
  const [active, setActive] = useState<Dir | null>(null);
  const [hovered, setHovered] = useState<Dir | null>(null);

  const makeHandlers = (dir: Dir) => ({
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onNavigate(dir);
    },
    onMouseDown: (e: React.MouseEvent) => {
      e.stopPropagation();
      setActive(dir);
    },
    onMouseUp: (e: React.MouseEvent) => {
      e.stopPropagation();
      setActive(null);
    },
    onMouseEnter: () => setHovered(dir),
    onMouseLeave: (e: React.MouseEvent) => {
      e.stopPropagation();
      setActive(null);
      setHovered(null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        onNavigate(dir);
      }
    },
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': `Navigate ${dir}`,
  });

  const btnClass = (dir: Dir) =>
    active === dir ? styles.padBtnActive : hovered === dir ? styles.padBtnHover : styles.padBtn;

  return (
    <div
      className={styles.padGrid}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div />
      <button className={btnClass('forward')} {...makeHandlers('forward')}>
        <IconSvg path={NAV_ARROW_FORWARD} size={22} />
        <span>Forward</span>
      </button>
      <div />

      <button className={btnClass('left')} {...makeHandlers('left')}>
        <IconSvg path={NAV_ARROW_LEFT} size={22} />
        <span>Strafe</span>
      </button>
      <button className={btnClass('backward')} {...makeHandlers('backward')}>
        <IconSvg path={NAV_ARROW_BACK} size={22} />
        <span>Reverse</span>
      </button>
      <button className={btnClass('right')} {...makeHandlers('right')}>
        <IconSvg path={NAV_ARROW_RIGHT} size={22} />
        <span>Strafe</span>
      </button>
    </div>
  );
};

// ============================================================================
// Main Dashboard UI
// ============================================================================

export const DashboardUI: React.FC<DashboardUIProps> = ({
  isVisible,
  hudMode = 'compact',
  isRadioPlaying,
  isMapOpen = false,
  onNavigate,
  onToggleGPS,
  onToggleRadio,
  onRainIntensity,
  onSnowIntensity,
  onWind,
  onTimeOfDay,
  onToggleRoof,
  onToggleWipers,
  onToggleVehicle,
  onToggleHeadlights,
  onToggleHighBeam,
  onToggleDomeLight,
  onToggleRearFeed,
  onWindowTint,
  onSeatDistance,
  isRoofOpen,
  wipersEnabled = false,
  headlightsOn = false,
  highBeam = false,
  domeLightOn = false,
  rearFeedEnabled = false,
  rearFeedStatus,
  currentVehicle = 'sedan',
  rainIntensity,
  snowIntensity = 0,
  wind = 0,
  windowTint = 0.1,
  seatDistance = 0,
  maxSeatDistance = 0.6,
  timeOfDay,
  analyser,
  nightIntensity = 0,
  ambientLightColor = 'rgba(255, 255, 255, 0.0)',
  stationName = '',
  stationTags = '',
  speedKmh,
  rpm,
  gear,
}) => {
  const hasTelemetry = speedKmh !== undefined;
  const displaySpeedKmh = hasTelemetry ? speedKmh! : 0;
  const displayRpm = hasTelemetry ? rpm ?? 0 : 0;
  const displayGear = hasTelemetry ? gear ?? 'D' : 'P';

  // Event handlers – prevent propagation to underlying canvas
  const stopProp = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  if (!isVisible) return null;

  const getVehicleLabel = () => {
    switch (currentVehicle) {
      case 'convertible':
        return 'Sport';
      case 'science-lab':
        return 'Lab';
      case 'limousine':
        return 'Limo';
      default:
        return 'Sedan';
    }
  };

  const themeStyle = applyTheme(darkTheme, {
    ambientLightColor: clusterAmbientGlow(currentVehicle, nightIntensity, ambientLightColor),
    nightIntensity,
  });

  return (
    <div
      className={styles.wrapper}
      style={{ pointerEvents: 'auto', ...themeStyle }}
      onMouseDown={stopProp}
      onMouseUp={stopProp}
      onMouseMove={stopProp}
      onClick={stopProp}
      onWheel={stopProp}
      onKeyDown={stopProp}
      onKeyUp={stopProp}
      role="region"
      aria-label="Car Dashboard Controls"
    >
      {hudMode === 'immersive' ? (
        <div className={styles.immersiveChip}>
          <TelemetryChip
            speedKmh={displaySpeedKmh}
            rpm={displayRpm}
            gear={displayGear}
            nightGlow={nightIntensity}
          />
        </div>
      ) : hudMode === 'compact' ? (
        <div className={styles.compactChip}>
          <TelemetryChip
            speedKmh={displaySpeedKmh}
            rpm={displayRpm}
            gear={displayGear}
            nightGlow={nightIntensity}
          />
          <div className={styles.compactButtons}>
            <ControlButton
              active={isMapOpen}
              onClick={onToggleGPS}
              ariaLabel="Toggle GPS"
            >
              <IconSvg path={GPS_ICON} size={18} fill={isMapOpen ? '#fff' : 'rgba(255,255,255,0.7)'} />
              <Label>GPS</Label>
            </ControlButton>
            <ControlButton
              active={isRadioPlaying}
              onClick={onToggleRadio}
              ariaLabel="Toggle Radio"
            >
              <IconSvg path={RADIO_ICON} size={18} fill={isRadioPlaying ? '#fff' : 'rgba(255,255,255,0.7)'} />
              <Label>Radio</Label>
            </ControlButton>
            {onToggleHeadlights && (
              <ControlButton
                active={headlightsOn}
                onClick={onToggleHeadlights}
                ariaLabel="Toggle Headlights"
              >
                <IconSvg path={HEADLIGHT_ICON} size={18} fill={headlightsOn ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>Lights</Label>
              </ControlButton>
            )}
            {onToggleWipers && (
              <ControlButton
                active={wipersEnabled}
                onClick={onToggleWipers}
                ariaLabel="Toggle Wipers"
              >
                <IconSvg path={WIPER_ICON} size={18} fill={wipersEnabled ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>Wipers</Label>
              </ControlButton>
            )}
          </div>
        </div>
      ) : (
      <DashboardContainer style={themeStyle}>
        {/* =====================================================================
            ZONE LEFT – Driving HUD
        ===================================================================== */}
        <ZoneLeft>
          <TelemetryChip
            speedKmh={displaySpeedKmh}
            rpm={displayRpm}
            gear={displayGear}
            nightGlow={nightIntensity}
          />
        </ZoneLeft>

        {/* =====================================================================
            ZONE CENTER – Media & Navigation
        ===================================================================== */}
        <ZoneCenter>
          <div className={styles.centerCol}>
            {/* Station metadata */}
            {stationName && (
              <div className={styles.stationMeta}>
                <span
                  className={
                    isRadioPlaying ? styles.stationNameActive : styles.stationNameInactive
                  }
                >
                  {stationName}
                </span>
                {stationTags && (
                  <span className={styles.stationTags}>
                    {stationTags.split(',').slice(0, 3).join(' · ')}
                  </span>
                )}
              </div>
            )}

            {/* Radio toggle + visualizer */}
            <ButtonRow>
              <ControlButton
                active={isRadioPlaying}
                onClick={onToggleRadio}
                ariaLabel="Toggle Radio"
              >
                <IconSvg path={RADIO_ICON} size={24} fill={isRadioPlaying ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>Radio</Label>
              </ControlButton>
              <AudioVisualizer
                analyser={analyser}
                isActive={isRadioPlaying}
                width={180}
                height={32}
              />
            </ButtonRow>

            {/* Quick-access row */}
            <ButtonRow>
              <ControlButton active={isMapOpen} onClick={onToggleGPS} ariaLabel="Toggle GPS">
                <IconSvg path={GPS_ICON} size={24} fill={isMapOpen ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>GPS</Label>
              </ControlButton>
              {onToggleVehicle && (
                <ControlButton onClick={onToggleVehicle} ariaLabel="Toggle Vehicle">
                  <IconSvg path={VEHICLE_ICON} size={24} fill="rgba(255,255,255,0.7)" />
                  <Label>{getVehicleLabel()}</Label>
                </ControlButton>
              )}
              <ControlButton active={isRoofOpen} onClick={onToggleRoof} ariaLabel="Toggle Roof">
                <IconSvg path={ROOF_ICON} size={24} fill={isRoofOpen ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>{isRoofOpen ? 'Open' : 'Closed'}</Label>
              </ControlButton>
            </ButtonRow>

            {/* Direction pad */}
            {onNavigate && <DirectionPad onNavigate={onNavigate} />}
          </div>
        </ZoneCenter>

        {/* =====================================================================
            ZONE RIGHT – Environment Controls
        ===================================================================== */}
        <ZoneRight>
          {/* Light-control row */}
          <div className={styles.lightGrid}>
            {onToggleWipers && (
              <ControlButton
                active={wipersEnabled}
                onClick={onToggleWipers}
                ariaLabel="Toggle Wipers"
              >
                <IconSvg path={WIPER_ICON} size={20} fill={wipersEnabled ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>Wipers</Label>
              </ControlButton>
            )}
            {onToggleHeadlights && (
              <ControlButton
                active={headlightsOn}
                onClick={onToggleHeadlights}
                ariaLabel="Toggle Headlights"
              >
                <IconSvg path={HEADLIGHT_ICON} size={20} fill={headlightsOn ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>Lights</Label>
              </ControlButton>
            )}
            {headlightsOn && onToggleHighBeam && (
              <ControlButton
                active={highBeam}
                onClick={onToggleHighBeam}
                ariaLabel="Toggle High Beam"
              >
                <IconSvg path={HIGHBEAM_ICON} size={20} fill={highBeam ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>High</Label>
              </ControlButton>
            )}
            {onToggleDomeLight && (
              <ControlButton
                active={domeLightOn}
                onClick={onToggleDomeLight}
                ariaLabel="Toggle Dome Light"
              >
                <IconSvg path={DOME_ICON} size={20} fill={domeLightOn ? '#fff' : 'rgba(255,255,255,0.7)'} />
                <Label>Dome</Label>
              </ControlButton>
            )}
            {onToggleRearFeed && (
              <ControlButton
                active={rearFeedEnabled}
                onClick={onToggleRearFeed}
                ariaLabel={
                  'Toggle rear-view mirror imagery (uses billable Street View Static API requests)' +
                  (rearFeedStatus ? ` — ${rearFeedStatus}` : '')
                }
              >
                <IconSvg
                  path={REAR_MIRROR_ICON}
                  size={20}
                  fill={rearFeedEnabled ? '#fff' : 'rgba(255,255,255,0.7)'}
                />
                <Label>Rear</Label>
              </ControlButton>
            )}
          </div>

          {/* Billing note — the rear feed is the only control here that spends
              Google API quota, so it says so rather than hiding the cost. */}
          {onToggleRearFeed && (
            <div className={styles.rearFeedNote} role="note">
              <strong>Rear mirror imagery</strong>
              <span>
                {rearFeedStatus ??
                  (rearFeedEnabled ? 'On' : 'Off — no Street View Static requests')}
              </span>
              <span>Uses billable Street View Static requests (throttled, cached in memory only).</span>
            </div>
          )}

          {/* Weather sliders */}
          <div className={styles.weatherSliders}>
            <SliderControl
              label="Rain"
              value={rainIntensity}
              onChange={onRainIntensity}
            />
            {onSnowIntensity && (
              <SliderControl
                label="Snow"
                value={snowIntensity}
                onChange={onSnowIntensity}
              />
            )}
            {onWind && (
              <SliderControl
                label="Wind"
                value={wind}
                min={-100}
                max={100}
                onChange={onWind}
              />
            )}
            {onWindowTint && (
              <SliderControl
                label="Tint"
                value={windowTint}
                max={1}
                step={0.01}
                onChange={onWindowTint}
              />
            )}
            {onSeatDistance && (
              <SliderControl
                label="Seat"
                value={seatDistance}
                max={maxSeatDistance}
                step={0.01}
                onChange={onSeatDistance}
              />
            )}
          </div>

          {/* Time-of-Day selector */}
          <select
            value={timeOfDay}
            onChange={(e) => onTimeOfDay(e.target.value)}
            className={styles.timeSelect}
            aria-label="Select Time of Day"
            onMouseDown={stopProp}
            onClick={stopProp}
          >
            <option value="day">☀️ Day</option>
            <option value="sunset">🌅 Sunset</option>
            <option value="night">🌙 Night</option>
          </select>
        </ZoneRight>
      </DashboardContainer>
      )}
    </div>
  );
};

export default DashboardUI;
