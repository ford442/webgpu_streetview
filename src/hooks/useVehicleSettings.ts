import React, { useState, useEffect, useCallback } from 'react';
import { 
    VehicleType, 
    VehicleConfig, 
    VEHICLE_LIST, 
    getVehicleConfig, 
    isValidVehicleType,
    vehicleManager 
} from '../car/VehicleManager';

const STORAGE_KEY = 'webgpu_streetview_vehicle';

interface UseVehicleSettingsReturn {
    currentVehicle: VehicleType;
    vehicleConfig: VehicleConfig;
    setVehicle: (type: VehicleType) => void;
    nextVehicle: () => void;
    previousVehicle: () => void;
    isTransitioning: boolean;
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
    };
}

export default useVehicleSettings;
