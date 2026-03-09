import React, { useEffect, useCallback } from 'react';

export type KeyboardShortcut = {
    key: string;
    description: string;
    action: () => void;
    modifier?: 'ctrl' | 'alt' | 'shift' | 'meta';
    preventDefault?: boolean;
};

export type AccessibilitySettings = {
    highContrast: boolean;
    reducedMotion: boolean;
    largeText: boolean;
    screenReaderMode: boolean;
    keyboardOnlyMode: boolean;
};

const STORAGE_KEY = 'webgpu_streetview_a11y_settings';

export const defaultAccessibilitySettings: AccessibilitySettings = {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReaderMode: false,
    keyboardOnlyMode: false,
};

export function loadAccessibilitySettings(): AccessibilitySettings {
    if (typeof window === 'undefined') return defaultAccessibilitySettings;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return { ...defaultAccessibilitySettings, ...JSON.parse(stored) };
        }
    } catch {
        console.warn('Failed to load accessibility settings');
    }
    return defaultAccessibilitySettings;
}

export function saveAccessibilitySettings(settings: AccessibilitySettings): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        console.warn('Failed to save accessibility settings');
    }
}

export const KEYBOARD_SHORTCUTS = {
    MOVE_FORWARD: { key: 'ArrowUp', description: 'Move forward' },
    MOVE_BACKWARD: { key: 'ArrowDown', description: 'Move backward' },
    MOVE_LEFT: { key: 'ArrowLeft', description: 'Move left' },
    MOVE_RIGHT: { key: 'ArrowRight', description: 'Move right' },
    TOGGLE_NIGHT_MODE: { key: 'n', description: 'Toggle night mode' },
    TOGGLE_VEHICLE_SELECTOR: { key: 'v', description: 'Open vehicle selector' },
    TOGGLE_RADIO: { key: 'm', description: 'Toggle radio mute' },
    TOGGLE_CAR_MODE: { key: 'c', description: 'Toggle car mode' },
    TOGGLE_MAP: { key: 'g', description: 'Toggle GPS map' },
    TOGGLE_BOOKMARKS: { key: 'b', description: 'Toggle bookmarks panel' },
    TOGGLE_HISTORY: { key: 'h', description: 'Toggle history panel' },
    TOGGLE_SNAPSHOTS: { key: 's', description: 'Toggle snapshot gallery' },
    TAKE_SNAPSHOT: { key: 'p', description: 'Take snapshot' },
    TOGGLE_CRUISE: { key: 'r', description: 'Toggle cruise mode' },
    TOGGLE_COLOR_GRADING: { key: 'e', description: 'Toggle color grading panel' },
    TOGGLE_ACCESSIBILITY: { key: 'a', description: 'Toggle accessibility panel' },
    RECENTER_HEAD: { key: 'c', description: 'Recenter head position' },
    TOGGLE_HEAD_COUPLING: { key: 'h', description: 'Toggle head coupling mode' },
    STEER_LEFT: { key: 'a', description: 'Steer left' },
    STEER_RIGHT: { key: 'd', description: 'Steer right' },
    TOGGLE_WIPERS: { key: 'w', description: 'Toggle windshield wipers' },
    TOGGLE_ROOF: { key: 'o', description: 'Toggle convertible roof' },
    CLOSE_PANEL: { key: 'Escape', description: 'Close current panel' },
    FOCUS_NEXT: { key: 'Tab', description: 'Move to next control' },
    ACTIVATE: { key: 'Enter', description: 'Activate selected control' },
} as const;

export function useKeyboardShortcuts(
    shortcuts: KeyboardShortcut[],
    enabled: boolean = true
) {
    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            if (!enabled) return;

            for (const shortcut of shortcuts) {
                const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
                const modifierMatches = shortcut.modifier
                    ? (shortcut.modifier === 'ctrl' && event.ctrlKey) ||
                      (shortcut.modifier === 'alt' && event.altKey) ||
                      (shortcut.modifier === 'shift' && event.shiftKey) ||
                      (shortcut.modifier === 'meta' && event.metaKey)
                    : !event.ctrlKey && !event.altKey && !event.metaKey;

                if (keyMatches && modifierMatches) {
                    if (shortcut.preventDefault !== false) {
                        event.preventDefault();
                    }
                    shortcut.action();
                    break;
                }
            }
        },
        [shortcuts, enabled]
    );

    useEffect(() => {
        if (!enabled) return;
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown, enabled]);
}

export function useAnnouncer() {
    const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', priority);
        announcement.setAttribute('aria-atomic', 'true');
        announcement.className = 'visually-hidden';
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    }, []);

    return { announce };
}

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, isActive: boolean) {
    useEffect(() => {
        if (!isActive || !containerRef.current) return;

        const container = containerRef.current;
        const focusableElements = container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        const handleTabKey = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey && document.activeElement === firstElement) {
                e.preventDefault();
                lastElement?.focus();
            } else if (!e.shiftKey && document.activeElement === lastElement) {
                e.preventDefault();
                firstElement?.focus();
            }
        };

        container.addEventListener('keydown', handleTabKey);
        firstElement?.focus();

        return () => {
            container.removeEventListener('keydown', handleTabKey);
        };
    }, [isActive, containerRef]);
}

export interface SkipLinkProps {
    targetId: string;
    children: React.ReactNode;
}

export function SkipLink({ targetId, children }: SkipLinkProps) {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        const target = document.getElementById(targetId);
        if (target) {
            target.tabIndex = -1;
            target.focus();
        }
    };

    return (
        <a
            href={`#${targetId}`}
            onClick={handleClick}
            className="skip-link"
            style={{
                position: 'absolute',
                top: '-40px',
                left: '0',
                background: '#000',
                color: '#fff',
                padding: '8px 16px',
                zIndex: 10000,
                textDecoration: 'none',
                transition: 'top 0.2s',
            }}
            onFocus={(e) => {
                e.currentTarget.style.top = '0';
            }}
            onBlur={(e) => {
                e.currentTarget.style.top = '-40px';
            }}
        >
            {children}
        </a>
    );
}

export default useKeyboardShortcuts;
