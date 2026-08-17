import { useState, useRef, useCallback } from 'react';

export type GlobeTransition = 'inactive' | 'loading' | 'entering' | 'active' | 'exiting';

// Singleton load promise so multiple calls don't spawn duplicate <script> tags
let cesiumLoadPromise: Promise<void> | null = null;

/**
 * jsDelivr build root for the CDN globe SDK.
 * `check-bundle-budget.sh` allows one Pascal-case SDK token in main.js — this URL.
 */
export const CESIUM_SDK_BUILD_URL =
    'https://cdn.jsdelivr.net/npm/cesium@1.140.0/Build/Cesium';

/**
 * Loads the globe SDK from a CDN `<script>`/`<link>` tag instead of bundling
 * the `cesium` npm package, so the ~4MB globe stack never ships in the main
 * chunk. Shared by GlobeView and MiniMap's globe view.
 */
export function loadCesiumSDK(): Promise<void> {
    if (cesiumLoadPromise) return cesiumLoadPromise;
    cesiumLoadPromise = new Promise<void>((resolve, reject) => {
        // Derive the global / JS filename from the build URL so main.js only
        // contains one SDK token (the URL itself).
        const sdkName = CESIUM_SDK_BUILD_URL.slice(CESIUM_SDK_BUILD_URL.lastIndexOf('/') + 1);
        if ((window as unknown as Record<string, unknown>)[sdkName]) {
            resolve();
            return;
        }

        // Wait for document to be ready before appending scripts
        const loadScripts = () => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${CESIUM_SDK_BUILD_URL}/Widgets/widgets.css`;
            document.head.appendChild(link);

            const script = document.createElement('script');
            script.src = `${CESIUM_SDK_BUILD_URL}/${sdkName}.js`;
            script.onload = () => resolve();
            script.onerror = () => {
                cesiumLoadPromise = null; // allow retry
                reject(new Error('[GlobeMode] Failed to load globe SDK'));
            };
            document.body.appendChild(script);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', loadScripts);
        } else {
            loadScripts();
        }
    });
    return cesiumLoadPromise;
}

export interface GlobeModeControls {
    transition: GlobeTransition;
    /** True while the globe div should be rendered (entering/active/exiting) */
    isVisible: boolean;
    /** True only when fully entered and ready for interaction */
    isActive: boolean;
    /** True while loading, entering, active, or exiting (anything except inactive). */
    isEngaged: boolean;
    activate: () => Promise<void>;
    /** Begin exit animation when active/entering; no-op while loading/inactive. */
    deactivate: () => void;
    /** Abort immediately from loading, or begin exit from entering/active. */
    cancel: () => void;
    toggle: () => void;
    onEnterComplete: () => void;
    onExitComplete: () => void;
}

export function useGlobeMode(): GlobeModeControls {
    const [transition, setTransition] = useState<GlobeTransition>('inactive');
    const transitionRef = useRef<GlobeTransition>('inactive');
    const activateGenerationRef = useRef(0);

    const setT = useCallback((t: GlobeTransition) => {
        transitionRef.current = t;
        setTransition(t);
    }, []);

    const activate = useCallback(async () => {
        if (transitionRef.current !== 'inactive') return;
        const generation = ++activateGenerationRef.current;
        setT('loading');
        try {
            await loadCesiumSDK();
        } catch (err) {
            console.error(err);
            if (activateGenerationRef.current === generation) setT('inactive');
            return;
        }
        // User may have cancelled while the CDN script was still loading.
        if (activateGenerationRef.current !== generation) return;
        setT('entering');
    }, [setT]);

    const deactivate = useCallback(() => {
        const t = transitionRef.current;
        if (t === 'active' || t === 'entering') setT('exiting');
    }, [setT]);

    const cancel = useCallback(() => {
        const t = transitionRef.current;
        if (t === 'inactive' || t === 'exiting') return;
        activateGenerationRef.current += 1;
        if (t === 'loading') {
            setT('inactive');
            return;
        }
        setT('exiting');
    }, [setT]);

    const toggle = useCallback(() => {
        if (transitionRef.current === 'inactive') activate();
        else cancel();
    }, [activate, cancel]);

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
        isEngaged: transition !== 'inactive',
        activate,
        deactivate,
        cancel,
        toggle,
        onEnterComplete,
        onExitComplete,
    };
}
