import { useEffect, useState } from 'react';
import {
  loadAccessibilitySettings,
  type AccessibilitySettings,
} from '../hooks/useKeyboardShortcuts';

export interface UseAppAccessibilityResult {
  accessibilitySettings: AccessibilitySettings;
  setAccessibilitySettings: React.Dispatch<React.SetStateAction<AccessibilitySettings>>;
}

/** Accessibility settings state + body CSS class toggles. */
export function useAppAccessibility(): UseAppAccessibilityResult {
  const [accessibilitySettings, setAccessibilitySettings] = useState<AccessibilitySettings>(() =>
    loadAccessibilitySettings(),
  );

  useEffect(() => {
    document.body.classList.toggle('high-contrast', accessibilitySettings.highContrast);
    document.body.classList.toggle('reduced-motion', accessibilitySettings.reducedMotion);
    document.body.classList.toggle('large-text', accessibilitySettings.largeText);
    document.body.classList.toggle('keyboard-only-mode', accessibilitySettings.keyboardOnlyMode);
  }, [accessibilitySettings]);

  return { accessibilitySettings, setAccessibilitySettings };
}
