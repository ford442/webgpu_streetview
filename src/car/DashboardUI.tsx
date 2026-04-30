/**
 * DashboardUI.tsx
 * 
 * Premium Car Dashboard - Main Integration Component
 * Integrates DashboardLayout, Gauges, and Controls into a unified interface
 */

import React, { useEffect, useState, useCallback } from 'react';

// Import layout components
import { 
  DashboardContainer, 
  ZoneLeft, 
  ZoneCenter, 
  ZoneRight
} from './DashboardLayout';

// Import gauge components
import { 
  SpeedGauge, 
  RpmGauge, 
  GearIndicator 
} from './Gauges';

// Import control components and icons
import { 
  IconButton, 
  Slider, 
  AudioVisualizer, 
  injectSliderStyles,
  GPS_ICON,
  RADIO_ICON,
  ROOF_ICON,
  WIPER_ICON,
  HEADLIGHT_ICON,
  HIGHBEAM_ICON,
  DOME_ICON,
  SNOW_ICON,
  RAIN_ICON,
  WIND_ICON,
  VEHICLE_ICON,
  TINT_ICON
} from './Controls';

// ============================================================================
// Interface Definition
// ============================================================================

export interface DashboardUIProps {
    isVisible: boolean;
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
    onWindowTint?: (value: number) => void;
    isRoofOpen: boolean;
    wipersEnabled?: boolean;
    headlightsOn?: boolean;
    highBeam?: boolean;
    domeLightOn?: boolean;
    currentVehicle?: 'sedan' | 'convertible' | 'science-lab' | 'limousine';
    rainIntensity: number;
    snowIntensity?: number;
    wind?: number;
    windowTint?: number;
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
}

// ============================================================================
// DIRECTION PAD COMPONENT
// ============================================================================

interface DirectionPadProps {
    onNavigate: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
}

const NAV_ARROW_FORWARD = 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z';
const NAV_ARROW_BACK    = 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.58L4 12l8 8 8-8z';
const NAV_ARROW_LEFT    = 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z';
const NAV_ARROW_RIGHT   = 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z';

const DirectionPad: React.FC<DirectionPadProps> = ({ onNavigate }) => {
    const [activeBtn, setActiveBtn] = useState<string | null>(null);
    const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

    const getBtnStyle = (dir: string): React.CSSProperties => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2px',
        width: '60px',
        height: '54px',
        background: activeBtn === dir
            ? 'rgba(0,212,255,0.22)'
            : hoveredBtn === dir
                ? 'rgba(0,212,255,0.15)'
                : 'rgba(0, 180, 255, 0.08)',
        border: '1px solid rgba(0, 212, 255, 0.25)',
        borderRadius: '10px',
        color: hoveredBtn === dir ? '#00D4FF' : 'rgba(0, 212, 255, 0.85)',
        boxShadow: activeBtn === dir ? '0 0 12px rgba(0,212,255,0.4)' : 'none',
        cursor: 'pointer',
        fontSize: '8px',
        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace",
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        transition: 'background 0.15s, box-shadow 0.15s, color 0.15s',
        userSelect: 'none',
    });

    const makeHandlers = (dir: 'forward' | 'backward' | 'left' | 'right') => ({
        onClick:      (e: React.MouseEvent)    => { e.stopPropagation(); onNavigate(dir); },
        onMouseDown:  (e: React.MouseEvent)    => { e.stopPropagation(); setActiveBtn(dir); },
        onMouseUp:    (e: React.MouseEvent)    => { e.stopPropagation(); setActiveBtn(null); },
        onMouseMove:  (e: React.MouseEvent)    => { e.stopPropagation(); },
        onMouseEnter: (_e: React.MouseEvent)   => { setHoveredBtn(dir); },
        onMouseLeave: (e: React.MouseEvent)    => { e.stopPropagation(); setHoveredBtn(null); setActiveBtn(null); },
        onKeyDown:    (e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === ' ') onNavigate(dir); },
    });

    const NavArrow: React.FC<{ path: string }> = ({ path }) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d={path} />
        </svg>
    );

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '60px 60px 60px',
                gridTemplateRows: '54px 54px',
                gap: '4px',
                marginTop: '6px',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Row 1: [empty] [Forward] [empty] */}
            <div />
            <button style={getBtnStyle('forward')} aria-label="Move Forward" {...makeHandlers('forward')}>
                <NavArrow path={NAV_ARROW_FORWARD} />
                <span>Forward</span>
            </button>
            <div />

            {/* Row 2: [Strafe Left] [Reverse] [Strafe Right] */}
            <button style={getBtnStyle('left')} aria-label="Strafe Left" {...makeHandlers('left')}>
                <NavArrow path={NAV_ARROW_LEFT} />
                <span>Strafe</span>
            </button>
            <button style={getBtnStyle('backward')} aria-label="Move Backward" {...makeHandlers('backward')}>
                <NavArrow path={NAV_ARROW_BACK} />
                <span>Reverse</span>
            </button>
            <button style={getBtnStyle('right')} aria-label="Strafe Right" {...makeHandlers('right')}>
                <NavArrow path={NAV_ARROW_RIGHT} />
                <span>Strafe</span>
            </button>
        </div>
    );
};

// ============================================================================
// Component Implementation
// ============================================================================

export const DashboardUI: React.FC<DashboardUIProps> = ({
    isVisible,
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
    onWindowTint,
    isRoofOpen,
    wipersEnabled = false,
    headlightsOn = false,
    highBeam = false,
    domeLightOn = false,
    currentVehicle = 'sedan',
    rainIntensity,
    snowIntensity = 0,
    wind = 0,
    windowTint = 0.1,
    timeOfDay,
    audioElement,
    analyser,
    nightIntensity = 0,
    ambientLightColor = 'rgba(255, 255, 255, 0.0)',
    stationName = '',
    stationTags = '',
}) => {

    // Gauge simulation state
    const [simulatedSpeed, setSimulatedSpeed] = useState(45);
    const [simulatedRpm, setSimulatedRpm] = useState(2500);
    const [gear, setGear] = useState('D');

    // Inject slider styles on mount
    useEffect(() => {
        injectSliderStyles();
    }, []);

    // Audio visualizer now uses the analyser passed from parent (CarModeView)
    // This ensures the visualizer is synced with the actual audio playback

    // Simulate realistic gauge values
    useEffect(() => {
        const interval = setInterval(() => {
            // Random speed between 25-65 MPH with smooth transitions
            const targetSpeed = Math.floor(Math.random() * 40) + 25;
            setSimulatedSpeed(prev => {
                const diff = targetSpeed - prev;
                return prev + diff * 0.3; // Smooth transition
            });

            // RPM correlated with speed (1500-4000 range)
            const targetRpm = 1500 + (targetSpeed / 65) * 2500;
            setSimulatedRpm(prev => {
                const diff = targetRpm - prev;
                return prev + diff * 0.3;
            });

            // Occasionally shift gears for realism
            if (Math.random() > 0.9) {
                setGear(prev => {
                    if (prev === 'D') return Math.random() > 0.5 ? '3' : 'D';
                    return 'D';
                });
            }
        }, 2500);

        return () => clearInterval(interval);
    }, []);

    // Handle events - prevent propagation to underlying canvas
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.stopPropagation();
    }, []);

    // Don't render if not visible
    if (!isVisible) {
        return null;
    }

    // Get vehicle label
    const getVehicleLabel = () => {
        switch (currentVehicle) {
            case 'convertible': return 'Sport';
            case 'science-lab': return 'Lab';
            case 'limousine': return 'Limo';
            default: return 'Sedan';
        }
    };

    return (
        <div
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onClick={handleClick}
            onWheel={handleWheel}
            style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                pointerEvents: 'auto',
                zIndex: 100,
            }}
            role="region"
            aria-label="Car Dashboard Controls"
        >
            <DashboardContainer style={{
                boxShadow: `inset 0 0 60px ${ambientLightColor}`,
            }}>
                {/* Screen glare and subtle imperfection overlay — mimics LCD infotainment glass */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '16px',
                    pointerEvents: 'none',
                    zIndex: 1,
                    background: `
                        radial-gradient(ellipse 120% 40% at 30% 20%,
                            rgba(255,255,255,0.04) 0%, transparent 70%),
                        radial-gradient(ellipse 60% 80% at 70% 60%,
                            rgba(255,255,255,0.015) 0%, transparent 60%)
                    `,
                }} />

                {/* ============================================================================
                    ZONE LEFT - Driving HUD
                    Contains speedometer, gear indicator, and RPM gauge
                ============================================================================ */}
                <ZoneLeft>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        justifyContent: 'center',
                        height: '100%'
                    }}>
                        <SpeedGauge value={Math.round(simulatedSpeed)} size={120} unit="MPH" nightGlow={nightIntensity} />
                        <GearIndicator gear={gear} size={36} />
                        <RpmGauge value={Math.round(simulatedRpm)} size={120} nightGlow={nightIntensity} />
                    </div>
                </ZoneLeft>

                {/* ============================================================================
                    ZONE CENTER - Media & Navigation
                    Contains radio controls, audio visualizer, and vehicle controls
                ============================================================================ */}
                <ZoneCenter>
                    <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        gap: '12px' 
                    }}>
                        {/* Station metadata readout */}
                        {stationName && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '2px',
                                maxWidth: '220px',
                                overflow: 'hidden',
                            }}>
                                <span style={{
                                    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: isRadioPlaying ? '#00D4FF' : 'rgba(255,255,255,0.5)',
                                    textShadow: isRadioPlaying ? '0 0 8px rgba(0,212,255,0.6)' : 'none',
                                    letterSpacing: '0.05em',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    width: '100%',
                                    textAlign: 'center',
                                }}>
                                    {stationName}
                                </span>
                                {stationTags && (
                                    <span style={{
                                        fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                        fontSize: '9px',
                                        fontWeight: 500,
                                        color: 'rgba(255,255,255,0.4)',
                                        letterSpacing: '0.1em',
                                        textTransform: 'uppercase',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        width: '100%',
                                        textAlign: 'center',
                                    }}>
                                        {stationTags.split(',').slice(0, 3).join(' · ')}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Radio toggle button with visualizer */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <IconButton 
                                icon={RADIO_ICON} 
                                label="Radio" 
                                active={isRadioPlaying} 
                                onClick={onToggleRadio} 
                                ariaLabel="Toggle Radio" 
                            />
                            <AudioVisualizer 
                                analyser={analyser} 
                                isActive={isRadioPlaying} 
                                width={180} 
                                height={32} 
                            />
                        </div>

                        {/* Control buttons row */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <IconButton 
                                icon={GPS_ICON} 
                                label="GPS" 
                                active={isMapOpen} 
                                onClick={onToggleGPS} 
                                ariaLabel="Toggle GPS" 
                            />
                            {onToggleVehicle && (
                                <IconButton 
                                    icon={VEHICLE_ICON} 
                                    label={getVehicleLabel()} 
                                    onClick={onToggleVehicle} 
                                    ariaLabel="Toggle Vehicle" 
                                />
                            )}
                            <IconButton 
                                icon={ROOF_ICON} 
                                label={isRoofOpen ? 'Open' : 'Closed'} 
                                active={isRoofOpen} 
                                onClick={onToggleRoof} 
                                ariaLabel="Toggle Roof" 
                            />
                        </div>

                        {/* Directional navigation pad */}
                        {onNavigate && (
                            <DirectionPad onNavigate={onNavigate} />
                        )}
                    </div>
                </ZoneCenter>

                {/* ============================================================================
                    ZONE RIGHT - Environment Controls
                    Contains light controls, weather sliders, and time selector
                ============================================================================ */}
                <ZoneRight>
                    {/* Light controls grid */}
                    <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: '1fr 1fr', 
                        gap: '8px' 
                    }}>
                        {onToggleHeadlights && (
                            <IconButton 
                                icon={HEADLIGHT_ICON} 
                                label="Lights" 
                                active={headlightsOn} 
                                activeColor={headlightsOn ? '#FFC107' : '#00D4FF'}
                                onClick={onToggleHeadlights} 
                                size="sm"
                                ariaLabel="Toggle Headlights" 
                            />
                        )}
                        {headlightsOn && onToggleHighBeam && (
                            <IconButton 
                                icon={HIGHBEAM_ICON} 
                                label="High" 
                                active={highBeam} 
                                activeColor="#42A5F5"
                                onClick={onToggleHighBeam} 
                                size="sm"
                                ariaLabel="Toggle High Beam" 
                            />
                        )}
                        {onToggleDomeLight && (
                            <IconButton 
                                icon={DOME_ICON} 
                                label="Dome" 
                                active={domeLightOn} 
                                activeColor="#FFE8B0"
                                onClick={onToggleDomeLight} 
                                size="sm"
                                ariaLabel="Toggle Dome Light" 
                            />
                        )}
                        {rainIntensity > 0 && onToggleWipers && (
                            <IconButton 
                                icon={WIPER_ICON} 
                                label="Wipers" 
                                active={wipersEnabled} 
                                onClick={onToggleWipers} 
                                size="sm"
                                ariaLabel="Toggle Wipers" 
                            />
                        )}
                    </div>

                    {/* Weather sliders */}
                    <div style={{ marginTop: '8px' }}>
                        <Slider 
                            label="Rain" 
                            icon={RAIN_ICON} 
                            value={rainIntensity} 
                            onChange={onRainIntensity} 
                            color="#4FC3F7" 
                        />
                        {onSnowIntensity && (
                            <Slider 
                                label="Snow" 
                                icon={SNOW_ICON} 
                                value={snowIntensity} 
                                onChange={onSnowIntensity} 
                                color="#E3F2FD" 
                            />
                        )}
                        {onWind && (
                            <Slider 
                                label="Wind" 
                                icon={WIND_ICON} 
                                value={wind} 
                                min={-100} 
                                max={100} 
                                onChange={onWind} 
                                color="#B3E5FC" 
                            />
                        )}
                        {onWindowTint && (
                            <Slider 
                                label="Tint" 
                                icon={TINT_ICON} 
                                value={windowTint} 
                                onChange={onWindowTint} 
                                color="#81C784" 
                            />
                        )}
                    </div>

                    {/* Time of Day selector */}
                    <select 
                        value={timeOfDay} 
                        onChange={(e) => onTimeOfDay(e.target.value)}
                        style={{
                            marginTop: '8px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            padding: '6px 12px',
                            color: '#fff',
                            fontSize: '11px',
                            cursor: 'pointer',
                            outline: 'none',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        }}
                        aria-label="Select Time of Day"
                    >
                        <option value="day">☀️ Day</option>
                        <option value="sunset">🌅 Sunset</option>
                        <option value="night">🌙 Night</option>
                    </select>
                </ZoneRight>
            </DashboardContainer>
        </div>
    );
};

export default DashboardUI;
