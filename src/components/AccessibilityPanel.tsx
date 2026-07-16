import React, { useState, useEffect, useRef } from 'react';
import {
    AccessibilitySettings,
    saveAccessibilitySettings,
    KEYBOARD_SHORTCUTS,
    useFocusTrap,
} from '../hooks/useKeyboardShortcuts';

interface AccessibilityPanelProps {
    isOpen: boolean;
    onClose: () => void;
    settings: AccessibilitySettings;
    onSettingsChange: (settings: AccessibilitySettings) => void;
}

export const AccessibilityPanel: React.FC<AccessibilityPanelProps> = ({
    isOpen,
    onClose,
    settings,
    onSettingsChange,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [activeTab, setActiveTab] = useState<'settings' | 'shortcuts'>('settings');

    useFocusTrap(panelRef, isOpen);

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    // Prevent body scroll when panel is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const updateSetting = <K extends keyof AccessibilitySettings>(
        key: K,
        value: AccessibilitySettings[K]
    ) => {
        const newSettings = { ...settings, [key]: value };
        onSettingsChange(newSettings);
        saveAccessibilitySettings(newSettings);
    };

    const resetSettings = () => {
        const defaults = {
            highContrast: false,
            reducedMotion: false,
            largeText: false,
            screenReaderMode: false,
            keyboardOnlyMode: false,
        };
        onSettingsChange(defaults);
        saveAccessibilitySettings(defaults);
    };

    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="a11y-panel-title"
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 1000,
                backgroundColor: settings.highContrast ? '#000' : 'rgba(0, 0, 0, 0.95)',
                borderRadius: '16px',
                padding: '24px',
                minWidth: '360px',
                maxWidth: '90vw',
                maxHeight: '80vh',
                overflow: 'auto',
                boxShadow: settings.highContrast
                    ? '0 0 0 4px #fff'
                    : '0 20px 60px rgba(0, 0, 0, 0.5)',
                border: settings.highContrast ? '4px solid #fff' : '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: settings.largeText ? '16px' : '14px',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    paddingBottom: '16px',
                }}
            >
                <h2
                    id="a11y-panel-title"
                    style={{
                        margin: 0,
                        fontSize: settings.largeText ? '24px' : '20px',
                        fontWeight: 'bold',
                        color: settings.highContrast ? '#fff' : '#4CAF50',
                        fontFamily: 'system-ui, sans-serif',
                    }}
                >
                    ♿ Accessibility Settings
                </h2>
                <button
                    onClick={onClose}
                    aria-label="Close accessibility panel"
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#fff',
                        fontSize: '24px',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: '4px',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                >
                    ×
                </button>
            </div>

            {/* Tabs */}
            <div
                role="tablist"
                aria-label="Accessibility panel tabs"
                style={{
                    display: 'flex',
                    gap: '8px',
                    marginBottom: '20px',
                }}
            >
                <button
                    role="tab"
                    aria-selected={activeTab === 'settings'}
                    aria-controls="settings-panel"
                    id="settings-tab"
                    onClick={() => setActiveTab('settings')}
                    style={{
                        flex: 1,
                        padding: '10px',
                        border: 'none',
                        borderRadius: '8px',
                        backgroundColor: activeTab === 'settings' ? '#4CAF50' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: settings.largeText ? '16px' : '14px',
                        fontWeight: 'bold',
                        transition: 'all 0.2s',
                    }}
                >
                    ⚙️ Settings
                </button>
                <button
                    role="tab"
                    aria-selected={activeTab === 'shortcuts'}
                    aria-controls="shortcuts-panel"
                    id="shortcuts-tab"
                    onClick={() => setActiveTab('shortcuts')}
                    style={{
                        flex: 1,
                        padding: '10px',
                        border: 'none',
                        borderRadius: '8px',
                        backgroundColor: activeTab === 'shortcuts' ? '#4CAF50' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: settings.largeText ? '16px' : '14px',
                        fontWeight: 'bold',
                        transition: 'all 0.2s',
                    }}
                >
                    ⌨️ Keyboard Shortcuts
                </button>
            </div>

            {/* Settings Tab */}
            {activeTab === 'settings' && (
                <div
                    id="settings-panel"
                    role="tabpanel"
                    aria-labelledby="settings-tab"
                    style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
                >
                    <div
                        role="group"
                        aria-labelledby="visual-settings-title"
                        style={{
                            padding: '16px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '8px',
                        }}
                    >
                        <h3
                            id="visual-settings-title"
                            style={{
                                margin: '0 0 12px 0',
                                fontSize: settings.largeText ? '16px' : '14px',
                                color: '#fff',
                                fontFamily: 'system-ui, sans-serif',
                            }}
                        >
                            Visual Settings
                        </h3>

                        <ToggleSwitch
                            id="high-contrast"
                            label="High Contrast Mode"
                            description="Increase contrast for better visibility"
                            checked={settings.highContrast}
                            onChange={(checked) => updateSetting('highContrast', checked)}
                            largeText={settings.largeText}
                        />

                        <ToggleSwitch
                            id="reduced-motion"
                            label="Reduced Motion"
                            description="Minimize animations for vestibular disorders"
                            checked={settings.reducedMotion}
                            onChange={(checked) => updateSetting('reducedMotion', checked)}
                            largeText={settings.largeText}
                        />

                        <ToggleSwitch
                            id="large-text"
                            label="Large Text"
                            description="Increase text size throughout the interface"
                            checked={settings.largeText}
                            onChange={(checked) => updateSetting('largeText', checked)}
                            largeText={settings.largeText}
                        />
                    </div>

                    <div
                        role="group"
                        aria-labelledby="accessibility-settings-title"
                        style={{
                            padding: '16px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '8px',
                        }}
                    >
                        <h3
                            id="accessibility-settings-title"
                            style={{
                                margin: '0 0 12px 0',
                                fontSize: settings.largeText ? '16px' : '14px',
                                color: '#fff',
                                fontFamily: 'system-ui, sans-serif',
                            }}
                        >
                            Accessibility Features
                        </h3>

                        <ToggleSwitch
                            id="screen-reader-mode"
                            label="Screen Reader Optimizations"
                            description="Enhanced labels and descriptions for screen readers"
                            checked={settings.screenReaderMode}
                            onChange={(checked) => updateSetting('screenReaderMode', checked)}
                            largeText={settings.largeText}
                        />

                        <ToggleSwitch
                            id="keyboard-only-mode"
                            label="Keyboard Navigation Mode"
                            description="Optimize interface for keyboard-only navigation"
                            checked={settings.keyboardOnlyMode}
                            onChange={(checked) => updateSetting('keyboardOnlyMode', checked)}
                            largeText={settings.largeText}
                        />
                    </div>

                    <button
                        onClick={resetSettings}
                        style={{
                            padding: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: settings.largeText ? '16px' : '14px',
                            transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                        }}
                    >
                        Reset to Defaults
                    </button>
                </div>
            )}

            {/* Shortcuts Tab */}
            {activeTab === 'shortcuts' && (
                <div
                    id="shortcuts-panel"
                    role="tabpanel"
                    aria-labelledby="shortcuts-tab"
                    style={{ maxHeight: '400px', overflow: 'auto' }}
                >
                    <ShortcutsList settings={settings} />
                </div>
            )}

            {/* Footer hint */}
            <div
                style={{
                    marginTop: '20px',
                    paddingTop: '16px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                    textAlign: 'center',
                    fontSize: settings.largeText ? '14px' : '12px',
                    color: 'rgba(255, 255, 255, 0.5)',
                }}
            >
                Press Escape to close this panel
            </div>
        </div>
    );
};

/**
 * Toggle Switch Component
 */
const ToggleSwitch: React.FC<{
    id: string;
    label: string;
    description: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    largeText: boolean;
}> = ({ id, label, description, checked, onChange, largeText }) => {
    return (
        <label
            htmlFor={id}
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '12px',
                cursor: 'pointer',
                borderRadius: '6px',
                transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
            }}
        >
            <input
                type="checkbox"
                id={id}
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                style={{
                    width: '20px',
                    height: '20px',
                    marginTop: '2px',
                    accentColor: '#4CAF50',
                    cursor: 'pointer',
                }}
            />
            <div style={{ flex: 1 }}>
                <div
                    style={{
                        fontSize: largeText ? '16px' : '14px',
                        fontWeight: 'bold',
                        color: '#fff',
                        marginBottom: '4px',
                    }}
                >
                    {label}
                </div>
                <div
                    style={{
                        fontSize: largeText ? '14px' : '12px',
                        color: 'rgba(255, 255, 255, 0.6)',
                    }}
                >
                    {description}
                </div>
            </div>
        </label>
    );
};

/**
 * Keyboard Shortcuts List
 */
const ShortcutsList: React.FC<{ settings: AccessibilitySettings }> = ({ settings }) => {
    // Group shortcuts by category
    const categories = {
        'Navigation': ['MOVE_FORWARD', 'MOVE_BACKWARD', 'MOVE_LEFT', 'MOVE_RIGHT'],
        'Mode Toggles': [
            'TOGGLE_NIGHT_MODE',
            'TOGGLE_VEHICLE_SELECTOR',
            'TOGGLE_RADIO',
            'TOGGLE_CAR_MODE',
            'TOGGLE_MAP',
            'TOGGLE_BOOKMARKS',
            'TOGGLE_HISTORY',
            'TOGGLE_SNAPSHOTS',
            'TAKE_SNAPSHOT',
            'TOGGLE_CRUISE',
            'TOGGLE_COLOR_GRADING',
            'TOGGLE_ACCESSIBILITY',
            'TOGGLE_TOUR',
        ],
        'Car Mode': [
            'RECENTER_HEAD',
            'TOGGLE_HEAD_COUPLING',
            'STEER_LEFT',
            'STEER_RIGHT',
            'TOGGLE_WIPERS',
            'TOGGLE_ROOF',
        ],
        'General': ['CLOSE_PANEL', 'FOCUS_NEXT', 'ACTIVATE'],
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {Object.entries(categories).map(([category, keys]) => (
                <div key={category}>
                    <h4
                        style={{
                            margin: '0 0 8px 0',
                            fontSize: settings.largeText ? '14px' : '12px',
                            color: '#4CAF50',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            fontFamily: 'system-ui, sans-serif',
                        }}
                    >
                        {category}
                    </h4>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                        }}
                    >
                        {keys.map((key) => {
                            const shortcut = KEYBOARD_SHORTCUTS[key as keyof typeof KEYBOARD_SHORTCUTS];
                            return (
                                <div
                                    key={key}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '8px 12px',
                                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                        borderRadius: '4px',
                                    }}
                                >
                                    <span
                                        style={{
                                            fontSize: settings.largeText ? '14px' : '12px',
                                            color: '#fff',
                                        }}
                                    >
                                        {shortcut.description}
                                    </span>
                                    <kbd
                                        style={{
                                            padding: '4px 8px',
                                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                            borderRadius: '4px',
                                            fontSize: settings.largeText ? '13px' : '11px',
                                            fontFamily: 'monospace',
                                            color: '#4CAF50',
                                            border: '1px solid rgba(255, 255, 255, 0.2)',
                                        }}
                                    >
                                        {shortcut.key}
                                    </kbd>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default AccessibilityPanel;
