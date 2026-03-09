/**
 * VehicleManager.ts - Vehicle configuration system for car mode
 * Defines vehicle types, their configurations, and manages vehicle switching
 */

export type VehicleType = 'sedan' | 'convertible' | 'science-lab' | 'limousine';

export interface VehicleConfig {
    type: VehicleType;
    name: string;
    description: string;
    features: string[];
    interiorModel: string;
    hasRoof: boolean;
    seatCount: number;
    hasRearviewMirror: boolean;
    hasSteeringWheel: boolean;
    hasSideMirrors: boolean;
    hasWipers: boolean;
    hasDashboard: boolean;
    hasGauges: boolean;
    cameraPosition: { x: number; y: number; z: number };
    dashboardLayout: 'standard' | 'minimal' | 'lab' | 'luxury';
    accentColor: string;
    theme: 'dark' | 'light' | 'neon' | 'clinical';
}

export const VEHICLES: Record<VehicleType, VehicleConfig> = {
    sedan: {
        type: 'sedan',
        name: 'Executive Sedan',
        description: 'Classic 4-door sedan with full interior, dashboard, and luxury appointments.',
        features: ['Full dashboard', 'Rearview mirror', 'Side mirrors', 'Windshield wipers', 'Climate control', 'Leather seats'],
        interiorModel: 'sedan_interior',
        hasRoof: true,
        seatCount: 5,
        hasRearviewMirror: true,
        hasSteeringWheel: true,
        hasSideMirrors: true,
        hasWipers: true,
        hasDashboard: true,
        hasGauges: true,
        cameraPosition: { x: -0.3, y: 1.2, z: 0.0 },
        dashboardLayout: 'standard',
        accentColor: '#4CAF50',
        theme: 'dark',
    },
    convertible: {
        type: 'convertible',
        name: 'Sport Convertible',
        description: 'Open-top sports car for sunny drives. Toggle roof open/closed.',
        features: ['Retractable roof', 'Sport seats', 'Minimalist dash', 'Wind deflector', 'Sport steering wheel'],
        interiorModel: 'convertible_interior',
        hasRoof: false,
        seatCount: 2,
        hasRearviewMirror: true,
        hasSteeringWheel: true,
        hasSideMirrors: true,
        hasWipers: true,
        hasDashboard: true,
        hasGauges: true,
        cameraPosition: { x: -0.35, y: 1.15, z: 0.05 },
        dashboardLayout: 'minimal',
        accentColor: '#FF5722',
        theme: 'dark',
    },
    'science-lab': {
        type: 'science-lab',
        name: 'Mobile Science Lab',
        description: 'Research vehicle with monitoring equipment and data displays.',
        features: ['Sensor arrays', 'Data monitors', 'Sample storage', 'Analysis equipment', 'Recording systems'],
        interiorModel: 'lab_interior',
        hasRoof: true,
        seatCount: 3,
        hasRearviewMirror: false,
        hasSteeringWheel: true,
        hasSideMirrors: true,
        hasWipers: true,
        hasDashboard: true,
        hasGauges: false,
        cameraPosition: { x: -0.3, y: 1.25, z: -0.1 },
        dashboardLayout: 'lab',
        accentColor: '#00BCD4',
        theme: 'clinical',
    },
    limousine: {
        type: 'limousine',
        name: 'Luxury Limousine',
        description: 'Ultra-luxury extended vehicle with rear-facing seats and mini-bar.',
        features: ['Extended cabin', 'Mini bar', 'Privacy partition', 'Mood lighting', 'Entertainment system', 'Champagne holders'],
        interiorModel: 'limo_interior',
        hasRoof: true,
        seatCount: 8,
        hasRearviewMirror: false,
        hasSteeringWheel: true,
        hasSideMirrors: true,
        hasWipers: true,
        hasDashboard: true,
        hasGauges: true,
        cameraPosition: { x: -0.4, y: 1.3, z: 0.2 },
        dashboardLayout: 'luxury',
        accentColor: '#FFD700',
        theme: 'light',
    },
};

export const DEFAULT_VEHICLE: VehicleType = 'sedan';

export const VEHICLE_LIST = Object.values(VEHICLES);

/**
 * Get vehicle configuration by type
 */
export function getVehicleConfig(type: VehicleType): VehicleConfig {
    return VEHICLES[type] ?? VEHICLES[DEFAULT_VEHICLE];
}

/**
 * Check if a vehicle type is valid
 */
export function isValidVehicleType(type: string): type is VehicleType {
    return type in VEHICLES;
}

/**
 * Get next vehicle in rotation
 */
export function getNextVehicle(current: VehicleType): VehicleType {
    const types = Object.keys(VEHICLES) as VehicleType[];
    const currentIndex = types.indexOf(current);
    const nextIndex = (currentIndex + 1) % types.length;
    return types[nextIndex];
}

/**
 * Get previous vehicle in rotation
 */
export function getPreviousVehicle(current: VehicleType): VehicleType {
    const types = Object.keys(VEHICLES) as VehicleType[];
    const currentIndex = types.indexOf(current);
    const prevIndex = (currentIndex - 1 + types.length) % types.length;
    return types[prevIndex];
}

/**
 * Vehicle manager class to handle vehicle state and transitions
 */
export class VehicleManager {
    private currentVehicle: VehicleType = DEFAULT_VEHICLE;
    private listeners: Set<(vehicle: VehicleType) => void> = new Set();
    private transitionCallbacks: Set<(from: VehicleType, to: VehicleType) => void> = new Set();

    /**
     * Get current vehicle type
     */
    getCurrentVehicle(): VehicleType {
        return this.currentVehicle;
    }

    /**
     * Get current vehicle configuration
     */
    getCurrentConfig(): VehicleConfig {
        return getVehicleConfig(this.currentVehicle);
    }

    /**
     * Set vehicle type with transition
     */
    setVehicle(type: VehicleType): void {
        if (type === this.currentVehicle) return;
        
        const previousVehicle = this.currentVehicle;
        this.currentVehicle = type;
        
        // Notify transition callbacks
        this.transitionCallbacks.forEach(cb => cb(previousVehicle, type));
        
        // Notify change listeners
        this.listeners.forEach(cb => cb(type));
    }

    /**
     * Cycle to next vehicle
     */
    nextVehicle(): void {
        this.setVehicle(getNextVehicle(this.currentVehicle));
    }

    /**
     * Cycle to previous vehicle
     */
    previousVehicle(): void {
        this.setVehicle(getPreviousVehicle(this.currentVehicle));
    }

    /**
     * Subscribe to vehicle changes
     */
    onChange(callback: (vehicle: VehicleType) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /**
     * Subscribe to vehicle transitions
     */
    onTransition(callback: (from: VehicleType, to: VehicleType) => void): () => void {
        this.transitionCallbacks.add(callback);
        return () => this.transitionCallbacks.delete(callback);
    }

    /**
     * Check if current vehicle has a specific feature
     */
    hasFeature(feature: keyof VehicleConfig): boolean {
        const config = this.getCurrentConfig();
        return Boolean(config[feature as keyof VehicleConfig]);
    }

    /**
     * Get accent color for UI theming
     */
    getAccentColor(): string {
        return this.getCurrentConfig().accentColor;
    }

    /**
     * Reset to default vehicle
     */
    reset(): void {
        this.setVehicle(DEFAULT_VEHICLE);
    }
}

// Singleton instance for global vehicle management
export const vehicleManager = new VehicleManager();
