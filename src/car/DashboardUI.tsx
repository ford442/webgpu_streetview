/**
 * DashboardUI.tsx
 * 
 * Premium Car Dashboard - Main Integration Component
 * Integrates DashboardLayout, Gauges, and Controls into a unified interface
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

// Import layout components
import { 
  DashboardContainer, 
  ZoneLeft, 
  ZoneCenter, 
  ZoneRight, 
  COLORS 
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
  VEHICLE_ICON
} from './Controls';

// ============================================================================
// Interface Definition
// ============================================================================

export interface DashboardUIProps {
    isVisible: boolean;
    isRadioPlaying: boolean;
    isMapOpen?: boolean;
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
    isRoofOpen: boolean;
    wipersEnabled?: boolean;
    headlightsOn?: boolean;
    highBeam?: boolean;
    domeLightOn?: boolean;
    currentVehicle?: 'sedan' | 'convertible' | 'science-lab' | 'limousine';
    rainIntensity: number;
    snowIntensity?: number;
    wind?: number;
    timeOfDay: string;
    audioElement?: HTMLAudioElement | null;
    analyser?: AnalyserNode | null;
}

// ============================================================================
// Component Implementation
// ============================================================================

export const DashboardUI: React.FC<DashboardUIProps> = ({
    isVisible,
    isRadioPlaying,
    isMapOpen = false,
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
    isRoofOpen,
    wipersEnabled = false,
    headlightsOn = false,
    highBeam = false,
    domeLightOn = false,
    currentVehicle = 'sedan',
    rainIntensity,
    snowIntensity = 0,
    wind = 0,
    timeOfDay,
    audioElement,
    analyser,
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
            <DashboardContainer>
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
                        <SpeedGauge value={Math.round(simulatedSpeed)} size={120} unit="MPH" />
                        <GearIndicator gear={gear} size={36} />
                        <RpmGauge value={Math.round(simulatedRpm)} size={120} />
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
