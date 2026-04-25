import { useEffect, useRef, useState, useCallback, ReactElement } from 'react';

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
    /** Start angle in degrees (0 = 3 o'clock, going clockwise) */
    startAngle?: number;
    /** Total arc sweep in degrees */
    arcSweep?: number;
    /** Enable gradient coloring based on value */
    useGradient?: boolean;
    /** Value at which color transitions to warning (for RPM redline) */
    warningThreshold?: number;
    /** Spring stiffness (higher = faster, more overshoot). Default 150. */
    stiffness?: number;
    /** Spring damping (higher = less overshoot). Default 16. */
    damping?: number;
    /** Night glow intensity 0–1: scales the digital-readout bloom at night. */
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Polar to Cartesian coordinate conversion
 * @param centerX - Center X coordinate
 * @param centerY - Center Y coordinate
 * @param radius - Radius
 * @param angleInDegrees - Angle in degrees (0 = 3 o'clock, clockwise)
 */
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

/**
 * Create SVG arc path description
 * @param x - Center X
 * @param y - Center Y
 * @param radius - Radius
 * @param startAngle - Start angle in degrees
 * @param endAngle - End angle in degrees
 */
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

/**
 * Clamp value between min and max
 */
const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

/**
 * Format number with leading zeros for display
 */
const formatNumber = (value: number, digits: number = 3): string =>
    Math.round(value).toString().padStart(digits, '0');

/**
 * Interpolate between two colors
 */
const interpolateColor = (
    color1: string,
    color2: string,
    factor: number
): string => {
    const hex2rgb = (hex: string): [number, number, number] => {
        const clean = hex.replace('#', '');
        const bigint = parseInt(clean, 16);
        return [
            (bigint >> 16) & 255,
            (bigint >> 8) & 255,
            bigint & 255,
        ];
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
// Hook for Spring-Physics Animated Values
// ============================================================================

/**
 * Hook for spring-physics animation with overshoot and settle behaviour.
 * Uses semi-implicit Euler integration: acceleration → velocity → position.
 * The needle overshoots and bounces like a real physical instrument.
 */
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

    useEffect(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
        }
        lastTimeRef.current = performance.now();

        const step = (now: number) => {
            const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05); // cap at 50 ms
            lastTimeRef.current = now;

            const acc =
                -stiffness * (posRef.current - targetValue) -
                damping * velRef.current;
            velRef.current += acc * dt;
            posRef.current += velRef.current * dt;

            setDisplayValue(posRef.current);

            if (
                Math.abs(velRef.current) > 0.01 ||
                Math.abs(posRef.current - targetValue) > 0.05
            ) {
                rafRef.current = requestAnimationFrame(step);
            } else {
                // Settled — snap to target to avoid floating-point drift
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
    }, [targetValue, stiffness, damping]);

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

    // Calculate derived values
    const center = 50;
    const radius = 40;
    const endAngle = startAngle + arcSweep;
    const normalizedValue = (animatedValue - min) / (max - min);
    const currentAngle = startAngle + normalizedValue * arcSweep;

    // Generate tick marks
    const generateTicks = useCallback(() => {
        const ticks: any[] = [];
        const tickCount = segments;

        for (let i = 0; i <= tickCount; i++) {
            const angle = startAngle + (i / tickCount) * arcSweep;
            const isMajor = i % 5 === 0;
            const innerRadius = radius - (isMajor ? 6 : 3);
            const outerRadius = radius + (isMajor ? 2 : 1);

            const start = polarToCartesian(center, center, innerRadius, angle);
            const end = polarToCartesian(center, center, outerRadius, angle);

            // Check if this tick should be in warning color
            let tickColor = 'rgba(255, 255, 255, 0.4)';
            if (warningThreshold !== undefined) {
                const tickValue = min + (i / tickCount) * (max - min);
                if (tickValue >= warningThreshold) {
                    tickColor = 'rgba(255, 56, 100, 0.6)';
                }
            }

            ticks.push(
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

        return ticks;
    }, [segments, startAngle, arcSweep, center, radius, warningThreshold, min, max]);

    // Calculate progress color
    const getProgressColor = (): string => {
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
    };

    const progressColor = getProgressColor();
    const strokeDashOffset = 2 * Math.PI * radius * (1 - normalizedValue);

    // Scale factor for responsive sizing
    const scale = size / 100;

    return (
        <div
            style={{
                width: size,
                height: size * 1.15, // Extra space for label
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                userSelect: 'none',
            }}
        >
            <svg
                viewBox="0 0 100 100"
                style={{
                    width: size,
                    height: size,
                    overflow: 'visible',
                }}
            >
                <defs>
                    {/* Gradient definition */}
                    <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#00D4FF" />
                        <stop offset="100%" stopColor="#0099CC" />
                    </linearGradient>

                    {/* Glow filter */}
                    <filter id="gaugeGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Background track arc */}
                <path
                    d={describeArc(center, center, radius, startAngle, endAngle)}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.1)"
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                />

                {/* Tick marks */}
                <g>{generateTicks()}</g>

                {/* Progress arc with glow */}
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

                {/* Inner decorative ring */}
                <circle
                    cx={center}
                    cy={center}
                    r={radius - 12}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.05)"
                    strokeWidth={1}
                />
            </svg>

            {/* Digital value display */}
            <div
                style={{
                    position: 'absolute',
                    top: size * 0.45,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    pointerEvents: 'none',
                }}
            >
                <span
                    style={{
                        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                        fontSize: size * 0.24,
                        fontWeight: 700,
                        color: '#ffffff',
                        textShadow: nightGlow > 0.3
                            ? `0 0 ${8 + nightGlow * 16}px rgba(0, 212, 255, ${Math.min(0.3 + nightGlow * 0.5, 0.9)})`
                            : '0 0 10px rgba(0, 212, 255, 0.5)',
                        letterSpacing: '0.05em',
                        lineHeight: 1,
                    }}
                >
                    {Math.round(animatedValue).toString().padStart(3, '0')}
                </span>
                {unit && (
                    <span
                        style={{
                            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                            fontSize: size * 0.08,
                            fontWeight: 500,
                            color: 'rgba(255, 255, 255, 0.6)',
                            marginTop: size * 0.02,
                            letterSpacing: '0.1em',
                        }}
                    >
                        {unit}
                    </span>
                )}
            </div>

            {/* Label below */}
            <span
                style={{
                    fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    fontSize: size * 0.09,
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.7)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.2em',
                    marginTop: size * 0.08,
                }}
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

    // Determine color based on gear
    const getGearColor = (): string => {
        switch (displayGear) {
            case 'P':
                return '#4CAF50'; // Green for Park
            case 'R':
                return '#FF3864'; // Red for Reverse
            case 'N':
                return '#FFC107'; // Amber for Neutral
            case 'D':
                return '#00D4FF'; // Cyan for Drive
            default:
                return '#00D4FF'; // Cyan for manual gears
        }
    };

    const gearColor = getGearColor();

    return (
        <div
            style={{
                width: size * 1.5,
                height: size * 1.5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
            }}
        >
            {/* Gear display box */}
            <div
                style={{
                    width: size * 1.25,
                    height: size * 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    borderRadius: size * 0.2,
                    border: `2px solid ${isActive ? gearColor : 'rgba(255, 255, 255, 0.2)'}`,
                    boxShadow: isActive
                        ? `0 0 ${size * 0.25}px ${gearColor}40, inset 0 0 ${size * 0.15}px ${gearColor}20`
                        : 'none',
                    transition: 'all 0.2s ease-out',
                }}
            >
                <span
                    style={{
                        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                        fontSize: size * 0.7,
                        fontWeight: 700,
                        color: isActive ? gearColor : 'rgba(255, 255, 255, 0.4)',
                        textShadow: isActive ? `0 0 ${size * 0.15}px ${gearColor}` : 'none',
                        transition: 'all 0.2s ease-out',
                    }}
                >
                    {displayGear}
                </span>
            </div>

            {/* Gear label */}
            <span
                style={{
                    fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    fontSize: size * 0.2,
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.5)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em',
                    marginTop: size * 0.15,
                }}
            >
                Gear
            </span>
        </div>
    );
};

// ============================================================================
// Combined Dashboard Component (for convenience)
// ============================================================================

export interface GaugeDashboardProps {
    speed: number;
    rpm: number;
    gear: string;
    size?: 'small' | 'medium' | 'large';
    unit?: 'MPH' | 'KPH';
}

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
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: gaugeSize * 0.2,
                padding: '20px',
            }}
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

export default {
    CircularGauge,
    SpeedGauge,
    RpmGauge,
    GearIndicator,
    GaugeDashboard,
};
