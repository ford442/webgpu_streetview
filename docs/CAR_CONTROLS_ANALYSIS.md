# WebGPU StreetView - Car Interior Controls Analysis

> **Historical.** Pre-#171 analysis. Head/chassis split lives in `src/car/carSpatialModel.ts` and `CarInputHandler.tsx`, not `App.tsx`. See [`AGENTS.md`](../AGENTS.md) car spatial checklist.

## Current Control Scheme

### Free Look (Head Movement Inside Car)
- **Mouse Drag**: Look around inside car (yaw/pitch)
- **Head tracking**: headYawOffset, headPitch relative to car

### Car Steering (Car Body Movement)
- **A/D Keys**: Turn car left/right
- **Shift + Mouse Drag**: Steer car horizontally
- **Steering Wheel Click + Drag**: Click on wheel to steer

### Movement
- **W/S or Arrow Up/Down**: Move forward/backward
- **Right Click**: Move forward

## Issues Found

### 1. Control Confusion
The current implementation mixes head look and car steering in ways that might confuse users:

1. Mouse drag = Free look (good)
2. A/D = Car steering (good)
3. Shift+drag = Car steering (might conflict with user expectations)

### 2. Missing Separation
When steering with A/D, the head should optionally:
- Turn with the car (rigid body - current behavior)
- Stay fixed relative to world (independent head)
- Lag behind car turn (natural body physics)

## Proposed Fixes

### Option 1: Clear Mode Separation (Recommended)
```
Mode: FREE LOOK (default in car)
- Mouse: Look around freely
- A/D: Steer car (car turns, head yaw stays relative)
- W/S: Drive

Mode: FIXED HEAD (alternative)
- Mouse: Inactive or minimal
- A/D: Steer car (head turns with car)
- W/S: Drive
```

### Option 2: Physics-Based Head
- Head naturally lags behind car turns
- Mouse can override to look around
- Head returns to forward after mouse release

### Option 3: Key-Based Toggle
- **Tab**: Toggle between free look and fixed head modes
- Visual indicator shows current mode

## Implementation Notes

The key issue is in `App.tsx`:

```typescript
const handleSteer = useCallback((direction: 'left' | 'right', deltaTime: number) => {
    // Currently: car turns, head offset stays the same (relative)
    // This means the head TURNS WITH the car (rigid body)
    
    // For true separation, we might want:
    // - Car turns
    // - Head offset compensates to stay looking at same world direction
    //   OR
    // - Head offset stays fixed (current - means head turns with car)
}, [isCarMode]);
```

## Suggested Fix

Add a toggle for "head coupling mode":

```typescript
const [headCoupling, setHeadCoupling] = useState<'rigid' | 'free'>('rigid');

// In handleSteer:
if (headCoupling === 'free') {
    // Car turns, but head compensates to stay looking same world direction
    setHeadYawOffset(prev => prev + turnAmount);
} else {
    // Rigid body - head turns with car (current behavior)
    // No change to headYawOffset needed
}
```

## Control Bindings Summary

| Input | Current | Proposed Fix |
|-------|---------|--------------|
| Mouse drag | Free look | Free look (unchanged) |
| A/D | Steer car + head rigid | Steer car + toggle for head coupling |
| Shift+drag | Steer car | Same or remove (redundant) |
| Wheel click | Steer | Same |
| Tab | - | Toggle head coupling mode |
| C | Toggle car mode / Recenter | Same |
