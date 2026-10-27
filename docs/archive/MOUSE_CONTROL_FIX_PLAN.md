# Mouse Control Fix Plan - Car Mode Head Look vs Steering

> **Historical.** The App.tsx-mediator plan is superseded. Live head vs chassis model: `src/car/carSpatialModel.ts`, `src/hooks/useViewMode.tsx`, `src/components/CarInputHandler.tsx`. See [`AGENTS.md`](../AGENTS.md).

## Executive Summary

The current car mode implementation has a **critical architectural flaw** causing the "car to shift around" when using mouse look. This document provides a comprehensive analysis and step-by-step fix plan.

**Key Finding**: The Street View panorama incorrectly rotates with head movement when it should stay locked to the car's forward direction.

---

## 🔴 Root Cause Analysis

### The Bug (App.tsx Line 402)

```typescript
// ❌ INCORRECT - Current implementation
const povHeading = isCarMode ? viewHeading : heading;
```

**Problem**: `viewHeading` includes `headYawOffset` (head look direction), so when the user drags to look left, the entire Street View panorama rotates left.

**Result**: The outside world spins when the user is just trying to look around inside the car.

### Expected vs Actual Behavior

| Action | Expected | Actual | Status |
|--------|----------|--------|--------|
| Mouse drag left | Look left, world stays still | World rotates left | ❌ **BUG** |
| Keyboard A/D | Car turns | Works correctly | ✅ |

### Why This Happens

In a real car:
1. **Dashboard/interior** stays fixed to the car (rotates with steering)
2. **Outside world** stays fixed relative to the car's direction (windshield always shows forward)
3. **Your head** rotates independently to look around

Current implementation (wrong):
- ✅ Interior rotates with car steering
- ❌ Outside world rotates with head look (should stay fixed to car)
- ❌ No separation between head look and car direction

---

## 📐 Architecture Fix

### Fix 1: Lock Panorama to Car Heading (CRITICAL)

**File**: `src/App.tsx`  
**Lines**: 396-406

```typescript
// BEFORE (BUG):
useEffect(() => {
    if (panorama) {
        const povHeading = isCarMode ? viewHeading : heading;  // ❌ BUG
        const povPitch = isCarMode ? headPitch : pitch;
        panorama.setPov({ heading: povHeading, pitch: povPitch });
    }
}, [heading, pitch, viewHeading, headPitch, isCarMode, panorama]);

// AFTER (FIXED):
useEffect(() => {
    if (panorama) {
        // In car mode: panorama stays locked to car direction (windshield view)
        // Head look is handled by the Three.js camera inside the car
        const povHeading = isCarMode ? carHeading : heading;  // ✅ FIXED
        const povPitch = isCarMode ? 0 : pitch;  // Car windshield is level
        panorama.setPov({ heading: povHeading, pitch: povPitch });
    }
}, [heading, pitch, carHeading, isCarMode, panorama]);
```

**Key Change**: Use `carHeading` instead of `viewHeading` for the panorama POV.

### Fix 2: Update viewHeading Calculation

**File**: `src/App.tsx`  
**Lines**: 180-184

```typescript
// BEFORE:
const viewHeading = React.useMemo(() => {
    return isCarMode
        ? ((carHeading + headYawOffset + 360) % 360)
        : heading;
}, [isCarMode, carHeading, headYawOffset, heading]);

// AFTER:
const viewHeading = React.useMemo(() => {
    return isCarMode
        ? ((carHeading - headYawOffset + 360) % 360)  // SUBTRACT for correct direction
        : heading;
}, [isCarMode, carHeading, headYawOffset, heading]);
```

**Why Subtract?**
- When you look left (positive `headYawOffset`), the camera rotates left
- The interior should appear to rotate RIGHT (you're turning away from it)
- The panorama should stay at `carHeading` (windshield always faces forward)
- The subtraction ensures correct coordinate system alignment

---

## 🎮 Steering Wheel Drag-to-Steer Implementation

### Overview
Enable users to steer the car by dragging the steering wheel, separate from head look.

### Implementation Steps

#### Step 1: Add `onMouseSteer` Prop to InputHandler

**File**: `src/components/InputHandler.tsx`

```typescript
// Line 10-11: Add new prop
interface InputHandlerProps {
    // ... existing props
    onSteer?: (direction: 'left' | 'right', deltaTime: number) => void;
    onMouseSteer?: (deltaX: number) => void;  // ← NEW
    // ...
}
```

#### Step 2: Update Mouse Move Handler

**File**: `src/components/InputHandler.tsx`  
**Lines**: 143-158

```typescript
const handleMouseMove = (e: MouseEvent) => {
    if (isMouseDownRef.current && dragStartedOnTargetRef.current) {
        const dist = Math.hypot(e.movementX, e.movementY);
        dragDistanceRef.current += dist;

        // MIDDLE MOUSE = Free look only (always)
        if (isMiddleMouseRef.current) {
            onPanRef.current(e.movementX, e.movementY);
        }
        // STEERING WHEEL DRAG = Car steering
        else if (isSteeringWheelDragRef.current && onMouseSteerRef.current) {
            onMouseSteerRef.current(e.movementX);  // ← NEW
        }
        // Normal drag = free look (head look)
        else {
            onPanRef.current(e.movementX, e.movementY);
        }
    }
};
```

#### Step 3: Add Ref for onMouseSteer

**File**: `src/components/InputHandler.tsx`  
**Line 56**: Add `const onMouseSteerRef = useRef(onMouseSteer);`

**Line 67-78**: Update the effect that keeps refs current:
```typescript
useEffect(() => {
    onPanRef.current = onPan;
    onZoomRef.current = onZoom;
    onMoveRef.current = onMove;
    onRightClickMoveRef.current = onRightClickMove;
    onToggleCarModeRef.current = onToggleCarMode;
    onSteerRef.current = onSteer;
    onMouseSteerRef.current = onMouseSteer;  // ← NEW
    onRecenterHeadRef.current = onRecenterHead;
    onToggleHeadCouplingRef.current = onToggleHeadCoupling;
    isCarModeRef.current = isCarMode;
    isSteeringWheelAtPointRef.current = isSteeringWheelAtPoint;
});
```

#### Step 4: Implement handleMouseSteer in App.tsx

**File**: `src/App.tsx`  
**After line 267** (after handleSteer)

```typescript
// Mouse steering via steering wheel drag (horizontal movement steers car)
const handleMouseSteer = useCallback((deltaX: number) => {
    if (!isCarMode) return;
    
    // Scale factor for mouse steering sensitivity (degrees per pixel)
    const MOUSE_STEER_SENSITIVITY = 0.3;
    const turnAmount = deltaX * MOUSE_STEER_SENSITIVITY;
    
    // Update car heading based on drag direction
    setCarHeading(prev => {
        const newHeading = (prev + turnAmount + 360) % 360;
        return newHeading;
    });
    
    // Update steering wheel visual
    steeringInputRef.current = Math.max(-90, Math.min(90, 
        steeringInputRef.current + turnAmount * 0.5));
    setCarSteering(steeringInputRef.current);
    
    // Apply head coupling compensation
    if (headCoupling === 'free') {
        // In free mode, compensate head to maintain world direction
        setHeadYawOffset(prev => {
            const compensated = prev - turnAmount;
            return Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, compensated));
        });
    }
    // In 'rigid' mode: head turns with car automatically
}, [isCarMode, headCoupling]);
```

#### Step 5: Wire Up InputHandler

**File**: `src/App.tsx`  
**Around line 1291**

```typescript
<InputHandler
    isEnabled={isConnected && !showWelcome}
    targetRef={canvasContainerRef}
    onPan={handlePan}
    onZoom={handleZoom}
    onMove={handleMove}
    onRightClickMove={handleRightClickMove}
    onToggleCarMode={handleToggleCarMode}
    onSteer={handleSteer}
    onMouseSteer={handleMouseSteer}  // ← NEW
    onRecenterHead={handleRecenterHead}
    onToggleHeadCoupling={handleToggleHeadCoupling}
    isCarMode={isCarMode}
    isSteeringWheelAtPoint={isCarMode ? isCarSteeringWheelHit : undefined}
/>
```

---

## 🎯 Final Control Mapping

| Input | Action in Car Mode | State Affected |
|-------|-------------------|----------------|
| **Mouse drag on steering wheel** | Steer car | `carHeading` |
| **Mouse drag elsewhere** | Free look (head) | `headYawOffset`, `headPitch` |
| **Middle mouse drag** | Free look (always) | `headYawOffset`, `headPitch` |
| **Keyboard A/D** | Steer car | `carHeading` |
| **Keyboard W/ArrowUp** | Move forward | `panorama.setPano()` |
| **Keyboard S/ArrowDown** | Move backward | `panorama.setPano()` |
| **Right click** | Move forward | `panorama.setPano()` |
| **H key** | Toggle head coupling | `headCoupling` |
| **C key (long press)** | Recenter head | `headYawOffset=0`, `headPitch=0` |

---

## 🔧 Head Coupling Mode Fix

### Current Issue
The 'free' coupling mode doesn't properly clamp compensation within `MAX_HEAD_YAW` limits.

### Fix for handleSteer

**File**: `src/App.tsx`  
**Lines**: 245-267

```typescript
const handleSteer = useCallback((direction: 'left' | 'right', deltaTime: number) => {
    if (!isCarMode) return;
    const turnRate = KEYBOARD_STEER_RATE * deltaTime;
    
    if (direction === 'left') {
        setCarHeading(prev => (prev - turnRate + 360) % 360);
        steeringInputRef.current = Math.max(-90, steeringInputRef.current - turnRate * 0.5);
        
        if (headCoupling === 'free') {
            setHeadYawOffset(prev => {
                const compensated = prev + turnRate;
                return Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, compensated));
            });
        }
    } else {
        setCarHeading(prev => (prev + turnRate) % 360);
        steeringInputRef.current = Math.min(90, steeringInputRef.current + turnRate * 0.5);
        
        if (headCoupling === 'free') {
            setHeadYawOffset(prev => {
                const compensated = prev - turnRate;
                return Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, compensated));
            });
        }
    }
    setCarSteering(steeringInputRef.current);
}, [isCarMode, headCoupling]);
```

---

## 📊 Architecture Summary

### State Separation

```
┌─────────────────────────────────────────────────────────────┐
│                        CAR STATE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  carHeading        → Car body direction (affects panorama)  │
│  headYawOffset     → Head look left/right (camera only)     │
│  headPitch         → Head look up/down (camera only)        │
│  headCoupling      → 'rigid' or 'free'                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
┌──────────────────────┐      ┌──────────────────────────┐
│   Google Maps        │      │   Three.js Car Interior  │
│   Street View        │      │                          │
├──────────────────────┤      ├──────────────────────────┤
│                      │      │                          │
│  panorama.setPov({   │      │  camera.rotation =       │
│    heading:          │      │    headYaw + headPitch   │
│      carHeading  ←───┼──────┼─── NOT affected by       │
│  })                  │      │    carHeading!           │
│                      │      │                          │
│  (locked to car)     │      │  (moves with head)       │
└──────────────────────┘      └──────────────────────────┘
```

### Key Principle

**The outside world (panorama) should only change when:**
1. The car steers (A/D keys or steering wheel drag)
2. The car moves to a new position (W/S keys)

**The outside world should NOT change when:**
- The user looks around with mouse (head look)

---

## ✅ Implementation Checklist

### Critical Fixes (Must Do)
- [ ] **Fix 1**: Update panorama POV effect to use `carHeading` instead of `viewHeading`
- [ ] **Fix 2**: Update `viewHeading` calculation to subtract `headYawOffset`

### Steering Wheel Enhancement (Should Do)
- [ ] **Step 1**: Add `onMouseSteer` prop to `InputHandlerProps`
- [ ] **Step 2**: Update `handleMouseMove` to detect steering wheel drag
- [ ] **Step 3**: Add `onMouseSteerRef` and update effect
- [ ] **Step 4**: Implement `handleMouseSteer` callback in `App.tsx`
- [ ] **Step 5**: Wire up `onMouseSteer` in `InputHandler` component

### Polish (Nice to Have)
- [ ] Add cursor feedback (grab/grabbing) when hovering over steering wheel
- [ ] Fix head coupling mode clamping
- [ ] Add visual indicator showing steering wheel is interactive
- [ ] Update documentation (CLAUDE.md, AGENTS.md)

---

## 🧪 Testing Scenarios

### Test 1: Mouse Look Without Steering
1. Enter car mode
2. Drag mouse left/right WITHOUT touching steering wheel
3. **Expected**: Head looks around, car stays pointing same direction, outside world stays fixed

### Test 2: Keyboard Steering
1. Enter car mode
2. Hold A or D key
3. **Expected**: Car turns, steering wheel animates, outside world rotates with car

### Test 3: Steering Wheel Drag
1. Enter car mode
2. Click and drag on steering wheel
3. **Expected**: Car turns, steering wheel follows mouse, outside world rotates with car

### Test 4: Head Coupling Modes
1. Enter car mode
2. Press H to toggle modes
3. Steer with A/D while looking left
4. **'rigid' mode**: Head should turn with car (stay looking at same part of interior)
5. **'free' mode**: Head should stay looking at same world direction

### Test 5: Combined Controls
1. Enter car mode
2. Look left with mouse (head look)
3. Steer with A/D
4. **Expected**: Car turns while maintaining head offset, outside world rotates correctly

---

## 📁 Files to Modify

| File | Changes |
|------|---------|
| `src/App.tsx` | Fix panorama POV (line 402), fix viewHeading (line 182), add handleMouseSteer, wire onMouseSteer |
| `src/components/InputHandler.tsx` | Add onMouseSteer prop, update handleMouseMove, add onMouseSteerRef |
| `CLAUDE.md` or `AGENTS.md` | Document new control scheme |

---

## 🎓 Design Philosophy

### Real Car Analogy

In a real car:
- **Windshield** always faces forward (locked to car direction)
- **Dashboard/interior** stays fixed to the car
- **Your head** can turn independently to look around
- **Steering wheel** controls car direction

This implementation mirrors that:
- **Panorama** = Windshield view (locked to `carHeading`)
- **CarInterior** = Dashboard/interior (rotates with `carHeading`)
- **Camera** = Your head (rotates with `headYawOffset`/`headPitch`)
- **Steering wheel drag** = Physical steering (changes `carHeading`)

---

*Generated: March 18, 2026*  
*Status: Analysis Complete, Ready for Implementation*
