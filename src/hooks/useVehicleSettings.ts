import { useState, useEffect, useCallback } from 'react';
import { 
    VehicleType, 
    VehicleConfig, 
    getVehicleConfig, 
    isValidVehicleType,
    vehicleManager 
} from '../car/VehicleManager';

const STORAGE_KEY = 'webgpu_streetview_vehicle';
const TINT_STORAGE_KEY = 'webgpu_streetview_window_tint';
const SEAT_STORAGE_KEY = 'webgpu_streetview_seat_distance';

/** Default pullback (metres) off the dashboard for a roomier default driving posture. */
const DEFAULT_SEAT_DISTANCE = 0.25;
/** Max seat pullback — keeps the eye ahead of the rear-seat/console geometry. */
export const MAX_SEAT_DISTANCE = 0.6;

interface UseVehicleSettingsReturn {
    currentVehicle: VehicleType;
    vehicleConfig: VehicleConfig;
    setVehicle: (type: VehicleType) => void;
    nextVehicle: () => void;
    previousVehicle: () => void;
    isTransitioning: boolean;
    windowTint: number;
    setWindowTint: (value: number) => void;
    seatDistance: number;
    setSeatDistance: (value: number) => void;
}

/**
 * Hook for managing vehicle settings with localStorage persistence
 */
export function useVehicleSettings(): UseVehicleSettingsReturn {
    const [currentVehicle, setCurrentVehicleState] = useState<VehicleType>(() => {
        // Initialize from localStorage or default
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && isValidVehicleType(stored)) {
                vehicleManager.setVehicle(stored);
                return stored;
            }
        }
        return vehicleManager.getCurrentVehicle();
    });

    const [isTransitioning, setIsTransitioning] = useState(false);

    const [windowTint, setWindowTintState] = useState<number>(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(TINT_STORAGE_KEY);
            if (stored) {
                const parsed = parseFloat(stored);
                if (!isNaN(parsed)) return Math.max(0, Math.min(1, parsed));
            }
        }
        return 0.1;
    });

    const [seatDistance, setSeatDistanceState] = useState<number>(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(SEAT_STORAGE_KEY);
            if (stored) {
                const parsed = parseFloat(stored);
                if (!isNaN(parsed)) return Math.max(0, Math.min(MAX_SEAT_DISTANCE, parsed));
            }
        }
        return DEFAULT_SEAT_DISTANCE;
    });

    // Sync with vehicle manager
    useEffect(() => {
        const unsubscribe = vehicleManager.onChange((vehicle) => {
            setCurrentVehicleState(vehicle);
        });
        return unsubscribe;
    }, []);

    // Persist to localStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, currentVehicle);
        }
    }, [currentVehicle]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(TINT_STORAGE_KEY, String(windowTint));
        }
    }, [windowTint]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(SEAT_STORAGE_KEY, String(seatDistance));
        }
    }, [seatDistance]);

    const setWindowTint = useCallback((value: number) => {
        setWindowTintState(Math.max(0, Math.min(1, value)));
    }, []);

    const setSeatDistance = useCallback((value: number) => {
        setSeatDistanceState(Math.max(0, Math.min(MAX_SEAT_DISTANCE, value)));
    }, []);

    const setVehicle = useCallback((type: VehicleType) => {
        if (type === currentVehicle) return;
        
        setIsTransitioning(true);
        
        // Simulate transition delay for smooth UI
        setTimeout(() => {
            vehicleManager.setVehicle(type);
            setIsTransitioning(false);
        }, 150);
    }, [currentVehicle]);

    const nextVehicle = useCallback(() => {
        setIsTransitioning(true);
        setTimeout(() => {
            vehicleManager.nextVehicle();
            setIsTransitioning(false);
        }, 150);
    }, []);

    const previousVehicle = useCallback(() => {
        setIsTransitioning(true);
        setTimeout(() => {
            vehicleManager.previousVehicle();
            setIsTransitioning(false);
        }, 150);
    }, []);

    const vehicleConfig = getVehicleConfig(currentVehicle);

    return {
        currentVehicle,
        vehicleConfig,
        setVehicle,
        nextVehicle,
        previousVehicle,
        isTransitioning,
        windowTint,
        setWindowTint,
        seatDistance,
        setSeatDistance,
    };
}

export default useVehicleSettings;
