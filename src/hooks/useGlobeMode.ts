import { useState, useRef, useCallback } from 'react';

export type GlobeTransition = 'inactive' | 'loading' | 'entering' | 'active' | 'exiting';

// Singleton load promise so multiple calls don't spawn duplicate <script> tags
let cesiumLoadPromise: Promise<void> | null = null;

function loadCesiumSDK(): Promise<void> {
    if (cesiumLoadPromise) return cesiumLoadPromise;
    cesiumLoadPromise = new Promise<void>((resolve, reject) => {
        if ((window as Window & { Cesium?: unknown }).Cesium) {
            resolve();
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.122/Build/Cesium/Widgets/widgets.css';
        document.head.appendChild(link);

        const script = document.createElement('script');
        script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.122/Build/Cesium/Cesium.js';
        script.onload = () => resolve();
        script.onerror = () => {
            cesiumLoadPromise = null; // allow retry
            reject(new Error('[GlobeMode] Failed to load Cesium SDK'));
        };
        document.body.appendChild(script);
    });
    return cesiumLoadPromise;
}

export interface GlobeModeControls {
    transition: GlobeTransition;
    /** True while the globe div should be rendered (entering/active/exiting) */
    isVisible: boolean;
    /** True only when fully entered and ready for interaction */
    isActive: boolean;
    activate: () => Promise<void>;
    deactivate: () => void;
    toggle: () => void;
    onEnterComplete: () => void;
    onExitComplete: () => void;
}

export function useGlobeMode(): GlobeModeControls {
    const [transition, setTransition] = useState<GlobeTransition>('inactive');
    const transitionRef = useRef<GlobeTransition>('inactive');

    const setT = useCallback((t: GlobeTransition) => {
        transitionRef.current = t;
        setTransition(t);
    }, []);

    const activate = useCallback(async () => {
        if (transitionRef.current !== 'inactive') return;
        setT('loading');
        try {
            await loadCesiumSDK();
        } catch (err) {
            console.error(err);
            setT('inactive');
            return;
        }
        setT('entering');
    }, [setT]);

    const deactivate = useCallback(() => {
        if (transitionRef.current !== 'active') return;
        setT('exiting');
    }, [setT]);

    const toggle = useCallback(() => {
        if (transitionRef.current === 'inactive') activate();
        else if (transitionRef.current === 'active') deactivate();
    }, [activate, deactivate]);

    const onEnterComplete = useCallback(() => {
        if (transitionRef.current === 'entering') setT('active');
    }, [setT]);

    const onExitComplete = useCallback(() => {
        setT('inactive');
    }, [setT]);

    return {
        transition,
        isVisible: transition !== 'inactive' && transition !== 'loading',
        isActive: transition === 'active',
        activate,
        deactivate,
        toggle,
        onEnterComplete,
        onExitComplete,
    };
}
