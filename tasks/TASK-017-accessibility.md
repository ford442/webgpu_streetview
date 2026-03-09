# TASK-017: Accessibility (A11y)

## Goal

Make the car interior viewer accessible to users with disabilities.

## Acceptance Criteria

- [ ] Keyboard navigation (Tab, Enter, Escape)
- [ ] Screen reader labels for all controls
- [ ] High contrast mode option
- [ ] Reduced motion option for vestibular disorders
- [ ] Voice control hints
- [ ] Alt text for visual elements

## Implementation

```typescript
// Add ARIA labels
<button aria-label="Toggle night mode">
  <span className="visually-hidden">Night Mode</span>
  🌙
</button>

// Keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'n') toggleNightMode();
    if (e.key === 'v') openVehicleSelector();
    if (e.key === 'm') toggleMute();
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

## Files

- `src/hooks/useKeyboardShortcuts.ts` — new
- `src/components/AccessibilityPanel.tsx` — settings UI
- Update existing components with ARIA labels

## Estimated Effort

3-4 hours
