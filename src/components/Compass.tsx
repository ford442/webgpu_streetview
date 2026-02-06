import React from 'react';

interface CompassProps {
    heading: number;
}

const Compass: React.FC<CompassProps> = ({ heading }) => {
    // Normalize heading to 0-360
    const normalizedHeading = ((heading % 360) + 360) % 360;
    
    // Rotate the needle counter-clockwise by the heading
    // This makes the needle always point to actual North
    const needleRotation = -normalizedHeading;

    return (
        <div
            style={{
                position: 'absolute',
                top: '20px',
                left: '20px',
                width: '80px',
                height: '80px',
                pointerEvents: 'none',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
            }}
        >
            {/* Compass Container */}
            <div
                style={{
                    width: '60px',
                    height: '60px',
                    position: 'relative',
                }}
            >
                {/* Outer Ring */}
                <svg
                    width="60"
                    height="60"
                    viewBox="0 0 60 60"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                    }}
                >
                    {/* Compass Circle Background */}
                    <circle
                        cx="30"
                        cy="30"
                        r="28"
                        fill="rgba(0, 0, 0, 0.6)"
                        stroke="#4CAF50"
                        strokeWidth="2"
                    />
                    
                    {/* Cardinal direction markers */}
                    <text
                        x="30"
                        y="12"
                        textAnchor="middle"
                        fill="#fff"
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="Arial, sans-serif"
                    >
                        N
                    </text>
                    <text
                        x="30"
                        y="52"
                        textAnchor="middle"
                        fill="#aaa"
                        fontSize="6"
                        fontFamily="Arial, sans-serif"
                    >
                        S
                    </text>
                    <text
                        x="50"
                        y="32"
                        textAnchor="middle"
                        fill="#aaa"
                        fontSize="6"
                        fontFamily="Arial, sans-serif"
                    >
                        E
                    </text>
                    <text
                        x="10"
                        y="32"
                        textAnchor="middle"
                        fill="#aaa"
                        fontSize="6"
                        fontFamily="Arial, sans-serif"
                    >
                        W
                    </text>
                    
                    {/* Tick marks */}
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                        <line
                            key={angle}
                            x1="30"
                            y1={angle % 90 === 0 ? "4" : "6"}
                            x2="30"
                            y2={angle % 90 === 0 ? "10" : "8"}
                            stroke="#fff"
                            strokeWidth={angle % 90 === 0 ? "2" : "1"}
                            transform={`rotate(${angle} 30 30)`}
                        />
                    ))}
                </svg>

                {/* Rotating Needle */}
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        width: '0',
                        height: '0',
                        transform: `translate(-50%, -50%) rotate(${needleRotation}deg)`,
                        transition: 'transform 0.1s ease-out',
                    }}
                >
                    <svg
                        width="60"
                        height="60"
                        viewBox="0 0 60 60"
                        style={{
                            position: 'absolute',
                            top: '-30px',
                            left: '-30px',
                        }}
                    >
                        {/* North-pointing arrow (Red) */}
                        <polygon
                            points="30,8 26,30 30,26 34,30"
                            fill="#ff4757"
                            stroke="#fff"
                            strokeWidth="0.5"
                        />
                        {/* South-pointing arrow (White) */}
                        <polygon
                            points="30,52 26,30 30,34 34,30"
                            fill="#fff"
                            stroke="#ccc"
                            strokeWidth="0.5"
                        />
                        {/* Center pivot */}
                        <circle
                            cx="30"
                            cy="30"
                            r="3"
                            fill="#4CAF50"
                            stroke="#fff"
                            strokeWidth="1"
                        />
                    </svg>
                </div>
            </div>

            {/* Heading Display */}
            <div
                style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid #4CAF50',
                    color: '#fff',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                    minWidth: '60px',
                    textAlign: 'center',
                }}
            >
                {normalizedHeading.toFixed(0)}°
            </div>
        </div>
    );
};

export default Compass;
