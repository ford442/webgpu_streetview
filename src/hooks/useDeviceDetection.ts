import { useState, useEffect, useCallback, useMemo } from 'react';
import { releaseGlContext } from '../utils/releaseGlContext';
import { getRuntimeContexts, readBatteryState, subscribeRuntimeContexts } from '../runtime/contexts';

interface DeviceCapabilities {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
  hasGyroscope: boolean;
  supportsWebGL: boolean;
  supportsWebGPU: boolean;
  pixelRatio: number;
  screenSize: {
    width: number;
    height: number;
  };
  memory?: number; // Estimated device memory in GB (if available)
  cpuCores: number;
}

interface QualitySettings {
  renderScale: number; // 0.5 - 1.0
  textureQuality: 'low' | 'medium' | 'high';
  shadowQuality: 'off' | 'low' | 'medium' | 'high';
  antialiasing: boolean;
  postProcessing: boolean;
  frameRate: number; // Target FPS
  batterySaveMode: boolean;
}

export interface UseDeviceDetectionReturn {
  device: DeviceCapabilities;
  quality: QualitySettings;
  setBatterySaveMode: (enabled: boolean) => void;
  setCustomQuality: (settings: Partial<QualitySettings>) => void;
  resetToOptimal: () => void;
}

/**
 * Detect mobile vs desktop and adjust quality settings accordingly
 */
export function useDeviceDetection(): UseDeviceDetectionReturn {
  // Device capability detection
  const detectCapabilities = useCallback((): DeviceCapabilities => {
    const userAgent = navigator.userAgent.toLowerCase();
    
    // Screen size detection
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Device type detection
    const isMobileUA = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/.test(userAgent);
    const isTabletUA = /ipad|android(?!.*mobile)|tablet/.test(userAgent) || 
                       (width >= 600 && width <= 1024 && !isMobileUA);
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // Check for gyroscope support
    const hasGyroscope = 'DeviceOrientationEvent' in window;
    
    // WebGL/WebGPU support detection
    let supportsWebGL = false;
    let supportsWebGPU = false;
    
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      supportsWebGL = !!gl;
      releaseGlContext(gl);
    } catch {
      supportsWebGL = false;
    }
    
    // WebGPU detection
    if ('gpu' in navigator) {
      supportsWebGPU = true;
    }
    
    // Memory estimation (Chrome only)
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    
    // CPU cores
    const cpuCores = navigator.hardwareConcurrency || 2;
    
    return {
      isMobile: isMobileUA && !isTabletUA,
      isTablet: isTabletUA,
      isDesktop: !isMobileUA && !isTabletUA,
      isTouchDevice: isTouch,
      hasGyroscope,
      supportsWebGL,
      supportsWebGPU,
      pixelRatio,
      screenSize: { width, height },
      memory,
      cpuCores,
    };
  }, []);

  const [device, setDevice] = useState<DeviceCapabilities>(detectCapabilities());
  
  // Calculate optimal quality settings based on device capabilities
  const calculateOptimalQuality = useCallback((caps: DeviceCapabilities): QualitySettings => {
    const { isMobile, isTablet, memory, cpuCores } = caps;
    
    // Base settings for different device tiers
    if (isMobile) {
      // Mobile phones - conservative settings for battery and performance
      const isHighEndMobile = (memory && memory >= 6) || cpuCores >= 6;
      
      return {
        renderScale: isHighEndMobile ? 0.75 : 0.5,
        textureQuality: isHighEndMobile ? 'medium' : 'low',
        shadowQuality: 'off',
        antialiasing: false,
        postProcessing: false,
        frameRate: isHighEndMobile ? 30 : 24,
        batterySaveMode: !isHighEndMobile,
      };
    }
    
    if (isTablet) {
      // Tablets - balanced settings
      const isHighEndTablet = (memory && memory >= 6) || cpuCores >= 6;
      
      return {
        renderScale: isHighEndTablet ? 0.9 : 0.75,
        textureQuality: isHighEndTablet ? 'high' : 'medium',
        shadowQuality: isHighEndTablet ? 'low' : 'off',
        antialiasing: isHighEndTablet,
        postProcessing: false,
        frameRate: isHighEndTablet ? 60 : 30,
        batterySaveMode: false,
      };
    }
    
    // Desktop - high settings
    const isLowEndDesktop = cpuCores <= 4 && (!memory || memory < 8);
    
    return {
      renderScale: isLowEndDesktop ? 0.9 : 1.0,
      textureQuality: isLowEndDesktop ? 'medium' : 'high',
      shadowQuality: isLowEndDesktop ? 'medium' : 'high',
      antialiasing: true,
      postProcessing: !isLowEndDesktop,
      frameRate: 60,
      batterySaveMode: false,
    };
  }, []);

  const [quality, setQuality] = useState<QualitySettings>(() => 
    calculateOptimalQuality(detectCapabilities())
  );

  const setBatterySaveMode = useCallback((enabled: boolean) => {
    setQuality((prev) => {
      if (enabled) {
        return {
          ...prev,
          batterySaveMode: true,
          renderScale: Math.min(prev.renderScale, 0.6),
          frameRate: Math.min(prev.frameRate, 24),
          shadowQuality: 'off',
          postProcessing: false,
          antialiasing: false,
        };
      } else {
        // Reset to device-optimal settings
        return calculateOptimalQuality(device);
      }
    });
  }, [calculateOptimalQuality, device]);

  // Update device info on resize
  useEffect(() => {
    const handleResize = () => {
      const newDevice = detectCapabilities();
      setDevice(newDevice);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [detectCapabilities]);

  // Battery saver: the battery is read once, by the capability manifest
  // (runtime/contexts.ts); this follows its level / charging updates.
  useEffect(() => {
    const check = () => {
      const battery = getRuntimeContexts().power.battery;
      // Enable battery save mode if battery is low (< 20%) and not charging
      if (battery && battery.level < 0.2 && !battery.charging && !quality.batterySaveMode) {
        setBatterySaveMode(true);
      }
    };
    void readBatteryState().then(check);
    return subscribeRuntimeContexts(check);
  }, [quality.batterySaveMode, setBatterySaveMode]);

  const setCustomQuality = useCallback((settings: Partial<QualitySettings>) => {
    setQuality((prev) => ({
      ...prev,
      ...settings,
    }));
  }, []);

  const resetToOptimal = useCallback(() => {
    setQuality(calculateOptimalQuality(device));
  }, [calculateOptimalQuality, device]);

  // Derived responsive breakpoints
  const breakpoints = useMemo(() => ({
    isSmallScreen: device.screenSize.width < 640,
    isMediumScreen: device.screenSize.width >= 640 && device.screenSize.width < 1024,
    isLargeScreen: device.screenSize.width >= 1024,
  }), [device.screenSize]);

  return {
    device: { ...device, ...breakpoints },
    quality,
    setBatterySaveMode,
    setCustomQuality,
    resetToOptimal,
  };
}

