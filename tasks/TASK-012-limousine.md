# TASK-012: Limousine Vehicle Variant

## Goal

Add a limousine with partition glass, rear-facing seats, and luxury amenities.

## Acceptance Criteria

- [x] Limo interior (extended cabin, partition glass, rear-facing seats)
- [x] Privacy partition with up/down toggle
- [x] Luxury amenities (mini bar, entertainment screens, mood lighting)
- [x] Different window layout (smaller, more private)
- [x] Intercom system (visual representation)
- [x] Chauffeur view option (look through partition)

## Implementation

Created `webgpu_streetview/src/car/variants/LimousineMode.ts`

### Features Implemented:

1. **Extended Cabin** - 4-meter long interior with luxury velvet ceiling, deep pile carpet, and wood trim
2. **Privacy Partition** - Smart glass partition with toggleable opacity (transparent/opaque)
3. **Rear-Facing Seats** - Two pairs of opposing seats with leather upholstery, headrests, armrests with controls
4. **Mini Bar** - Wood cabinet with glass top, crystal decanters, champagne bucket, LED accent lighting
5. **Entertainment Screens** - Main partition screen + individual passenger screens with configurable content (nav/entertainment/ambient/none)
6. **Mood Lighting System** - 4 modes (relaxing/business/party/romantic) with colored accent lights and starlight ceiling
7. **Private Windows** - Smaller tinted windows with privacy curtains and chrome frames
8. **Intercom System** - Visual control panel with speaker grill and status indicator
9. **Chauffeur View** - Camera position toggle to look through partition toward driver

### Public API:

```typescript
export interface LimoState {
  partitionOpen: boolean;
  moodLighting: 'relaxing' | 'business' | 'party' | 'romantic';
  entertainmentOn: boolean;
  intercomActive: boolean;
  chauffeurView: boolean;
  barLightOn: boolean;
  screenContent: 'none' | 'nav' | 'entertainment' | 'ambient';
}

export class LimousineMode {
  constructor(container: HTMLElement, initialState?: Partial<LimoState>);
  togglePartition(): boolean;
  setMoodLighting(mode: LimoState['moodLighting']): void;
  toggleEntertainment(): boolean;
  toggleBarLight(): boolean;
  toggleIntercom(): boolean;
  toggleChauffeurView(): boolean;
  setScreenContent(content: LimoState['screenContent']): void;
  getState(): LimoState;
  setState(newState: Partial<LimoState>): void;
  update(deltaTime: number): void;
  render(): void;
}

export function initLimousineMode(container: HTMLElement, initialState?: Partial<LimoState>): LimousineMode;
```

## Files Modified

- `src/car/variants/LimousineMode.ts` - Main implementation (39KB)
- `src/car/variants/index.ts` - Added exports
- `src/car/index.ts` - Added exports

## Status

**COMPLETED** - March 9, 2026
