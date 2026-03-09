import React from 'react';
import { VehicleType, VehicleConfig, VEHICLE_LIST } from '../car/VehicleManager';

interface VehicleSelectorProps {
    currentVehicle: VehicleType;
    onSelectVehicle: (type: VehicleType) => void;
    isVisible: boolean;
    isTransitioning?: boolean;
}

const vehicleIcons: Record<VehicleType, string> = {
    sedan: '🚗',
    convertible: '🏎️',
    'science-lab': '🔬',
    limousine: '🚙',
};

const VehicleCard: React.FC<{
    config: VehicleConfig;
    isSelected: boolean;
    onClick: () => void;
    isTransitioning: boolean;
}> = ({ config, isSelected, onClick, isTransitioning }) => {
    const baseStyle: React.CSSProperties = {
        padding: '16px',
        borderRadius: '12px',
        backgroundColor: isSelected ? 'rgba(76, 175, 80, 0.2)' : 'rgba(0, 0, 0, 0.6)',
        border: `2px solid ${isSelected ? config.accentColor : 'rgba(255, 255, 255, 0.1)'}`,
        cursor: isTransitioning ? 'wait' : 'pointer',
        transition: 'all 0.2s ease',
        minWidth: '140px',
        textAlign: 'center',
        opacity: isTransitioning ? 0.6 : 1,
    };

    const hoverStyle: React.CSSProperties = !isSelected && !isTransitioning
        ? { 
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderColor: 'rgba(255, 255, 255, 0.3)',
        }
        : {};

    return (
        <div
            style={baseStyle}
            onClick={onClick}
            onMouseEnter={(e) => {
                if (!isSelected && !isTransitioning) {
                    Object.assign(e.currentTarget.style, hoverStyle);
                }
            }}
            onMouseLeave={(e) => {
                if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }
            }}
        >
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>
                {vehicleIcons[config.type]}
            </div>
            <div
                style={{
                    fontSize: '13px',
                    fontWeight: 'bold',
                    color: isSelected ? config.accentColor : '#fff',
                    marginBottom: '4px',
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                {config.name}
            </div>
            <div
                style={{
                    fontSize: '11px',
                    color: 'rgba(255, 255, 255, 0.6)',
                    lineHeight: 1.3,
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                {config.seatCount} seats
            </div>
            {isSelected && (
                <div
                    style={{
                        marginTop: '8px',
                        fontSize: '10px',
                        color: config.accentColor,
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                    }}
                >
                    ACTIVE
                </div>
            )}
        </div>
    );
};

export const VehicleSelector: React.FC<VehicleSelectorProps> = ({
    currentVehicle,
    onSelectVehicle,
    isVisible,
    isTransitioning = false,
}) => {
    if (!isVisible) return null;

    const currentConfig = VEHICLE_LIST.find(v => v.type === currentVehicle);

    return (
        <div
            style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 1000,
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                borderRadius: '16px',
                padding: '24px',
                minWidth: '320px',
                maxWidth: '90vw',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(10px)',
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <h2
                    style={{
                        margin: '0 0 8px 0',
                        fontSize: '20px',
                        fontWeight: 'bold',
                        color: '#fff',
                        fontFamily: 'system-ui, sans-serif',
                    }}
                >
                    Select Vehicle
                </h2>
                <p
                    style={{
                        margin: 0,
                        fontSize: '13px',
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontFamily: 'system-ui, sans-serif',
                    }}
                >
                    Choose your ride for the journey
                </p>
            </div>

            {/* Current Vehicle Info */}
            {currentConfig && (
                <div
                    style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        padding: '12px',
                        marginBottom: '20px',
                        borderLeft: `3px solid ${currentConfig.accentColor}`,
                    }}
                >
                    <div
                        style={{
                            fontSize: '12px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            marginBottom: '4px',
                        }}
                    >
                        Currently Selected
                    </div>
                    <div
                        style={{
                            fontSize: '14px',
                            color: '#fff',
                            fontWeight: 500,
                        }}
                    >
                        {vehicleIcons[currentConfig.type]} {currentConfig.name}
                    </div>
                    <div
                        style={{
                            fontSize: '12px',
                            color: 'rgba(255, 255, 255, 0.6)',
                            marginTop: '4px',
                        }}
                    >
                        {currentConfig.description}
                    </div>
                </div>
            )}

            {/* Vehicle Grid */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '12px',
                    marginBottom: '20px',
                }}
            >
                {VEHICLE_LIST.map((vehicle) => (
                    <VehicleCard
                        key={vehicle.type}
                        config={vehicle}
                        isSelected={vehicle.type === currentVehicle}
                        onClick={() => onSelectVehicle(vehicle.type)}
                        isTransitioning={isTransitioning}
                    />
                ))}
            </div>

            {/* Features List */}
            {currentConfig && (
                <div
                    style={{
                        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                        paddingTop: '16px',
                    }}
                >
                    <div
                        style={{
                            fontSize: '11px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            marginBottom: '8px',
                        }}
                    >
                        Features
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px',
                        }}
                    >
                        {currentConfig.features.map((feature, index) => (
                            <span
                                key={index}
                                style={{
                                    fontSize: '11px',
                                    padding: '4px 10px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    borderRadius: '12px',
                                    color: 'rgba(255, 255, 255, 0.8)',
                                }}
                            >
                                {feature}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Close hint */}
            <div
                style={{
                    textAlign: 'center',
                    marginTop: '16px',
                    fontSize: '11px',
                    color: 'rgba(255, 255, 255, 0.4)',
                }}
            >
                Click outside or press ESC to close
            </div>
        </div>
    );
};

export default VehicleSelector;
