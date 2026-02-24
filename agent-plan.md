# WebGPU StreetView - Agent Implementation Plan

## Overview
This document tracks the implementation status of features recommended by the critic agent and the features that have been implemented.

## Features Implemented

### 1. ✅ Bookmarks/Favorites System
**Status:** Fully Implemented

**Description:**
Users can now save their favorite locations for quick access. Bookmarks are persisted in localStorage and survive page refreshes.

**How to Use:**
1. Navigate to any location you want to bookmark
2. Click the **"📌 Bookmarks"** button in the right-side control panel
3. Click **"+ Save Current Location"** in the panel that appears
4. Enter a name for your bookmark and click Save
5. Click **"Go"** on any bookmark to teleport to that location instantly
6. Click **"×"** to delete a bookmark

**Technical Details:**
- File: `src/hooks/useBookmarks.ts` - Custom hook for bookmark management
- File: `src/components/BookmarkPanel.tsx` - UI panel component
- Storage: localStorage key `webgpu_streetview_bookmarks`
- Each bookmark stores: id, name, lat, lng, heading, pitch, timestamp

---

### 2. ✅ Location History
**Status:** Fully Implemented

**Description:**
The application now automatically tracks all visited locations (with deduplication for locations visited within 10 meters and 1 minute). Users can revisit any previous location from their history.

**How to Use:**
1. The history is automatically tracked as you explore
2. Click the **"🕐 History"** button in the right-side control panel
3. Click on any history entry to teleport back to that location
4. Click the **"×"** on an entry to remove it
5. Click **"Clear All"** to delete all history

**Technical Details:**
- File: `src/hooks/useLocationHistory.ts` - Custom hook for history management
- File: `src/components/HistoryPanel.tsx` - UI panel component
- Storage: localStorage key `webgpu_streetview_history`
- Maximum 50 entries stored (oldest auto-removed)
- Deduplication: Locations within 10m visited <1 min apart are not added
- Each entry stores: id, lat, lng, heading, pitch, locationName, timestamp

---

### 3. ✅ Snapshot Gallery
**Status:** Fully Implemented

**Description:**
Snapshots are now saved to an in-app gallery with thumbnail previews. Users can view, rename, download, and navigate to the location of any saved snapshot.

**How to Use:**
1. Click **"📸 Take Snapshot"** to capture the current view
2. The snapshot is saved both to your downloads AND to the gallery
3. Click the **"📸 Gallery"** button to view all saved snapshots
4. Click on any snapshot thumbnail to view it full-size
5. In the full view:
   - **"🚀 Go to Location"** - Teleport to where the snapshot was taken
   - **"💾 Download"** - Re-download the image
   - **"Close"** - Return to gallery
6. In the gallery grid:
   - Click a snapshot name to rename it
   - **"⬇"** button to download
   - **"×"** button to delete
7. Click **"Clear All"** to delete all snapshots

**Technical Details:**
- File: `src/hooks/useSnapshots.ts` - Custom hook for snapshot management
- File: `src/components/SnapshotGallery.tsx` - UI gallery component with modal viewer
- Storage: localStorage key `webgpu_streetview_snapshots` (stores data URLs)
- Maximum 20 snapshots stored (oldest auto-removed to prevent quota issues)
- Each snapshot stores: id, name, dataUrl, timestamp, lat, lng, heading, pitch, zoom, locationName

---

## Architecture Overview

### New Files Created

```
src/
├── hooks/
│   ├── useBookmarks.ts       # Bookmark state management
│   ├── useLocationHistory.ts # History tracking logic
│   └── useSnapshots.ts       # Snapshot gallery management
└── components/
    ├── BookmarkPanel.tsx     # Bookmark UI panel
    ├── HistoryPanel.tsx      # History UI panel
    └── SnapshotGallery.tsx   # Gallery with modal viewer
```

### Integration Points in App.tsx

1. **Hooks Integration:**
   ```typescript
   const { bookmarks, addBookmark, removeBookmark } = useBookmarks();
   const { history, addToHistory, removeFromHistory, clearHistory } = useLocationHistory();
   const { snapshots, addSnapshot, removeSnapshot, updateSnapshotName, downloadSnapshot, clearAllSnapshots } = useSnapshots();
   ```

2. **Panel State:**
   ```typescript
   const [isBookmarkPanelOpen, setIsBookmarkPanelOpen] = useState(false);
   const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
   const [isSnapshotGalleryOpen, setIsSnapshotGalleryOpen] = useState(false);
   ```

3. **History Tracking:** Added to the `handlePanoChanged` effect to automatically log location changes

4. **Snapshot Enhancement:** Modified `handleSnapshot` to also save to the gallery

5. **Teleport Function:** Updated to accept optional heading/pitch and close panels after teleport

## Plan.md Status Updates

The following items from `plan.md` are now complete:

### High Priority - Location Features
- ✅ **Bookmarks/Favorites** - Save favorite locations for quick access
- ✅ **Location history** - Track and revisit previously viewed locations

### High Priority - Enhanced Snapshot System
- ✅ **Snapshot gallery** - View and manage previously saved snapshots

## Testing Checklist

- [ ] Bookmarks can be added, viewed, and deleted
- [ ] Clicking a bookmark teleports to the correct location with correct heading/pitch
- [ ] History automatically populates as you move
- [ ] History deduplication works (same location within 10m/1min doesn't duplicate)
- [ ] Snapshots appear in gallery after taking
- [ ] Gallery snapshots can be viewed full-size
- [ ] Gallery "Go to Location" works correctly
- [ ] Gallery rename and download functions work
- [ ] All data persists after page refresh
- [ ] Panels close when teleporting from them
- [ ] Only one panel can be open at a time

## Future Enhancements (Not Implemented)

Based on the original plan.md, these features remain for future implementation:

### High Priority
- **EXIF metadata embedding** - Store GPS coordinates, heading, pitch in actual image metadata
- **Historical Imagery (Time Travel)** - Time slider for viewing location history
- **POI overlay** - Show nearby restaurants, attractions
- **Digital compass** - Show current heading direction (already have a basic one)
- **Share functionality** - Direct share to social media or copy link (partially done with share link)

### Medium Priority
- **Distance measurement** - Measure distances between points
- **Theme options** - Light/dark mode
- **Keyboard shortcuts** - Customizable hotkeys
- **Control sensitivity** - Adjust mouse/keyboard sensitivity
- **Annotation tools** - Add notes or markers to locations
- **Tour creation** - Create guided tours through multiple locations

## Dependencies

No new dependencies were added. The implementation uses:
- React hooks (useState, useEffect, useCallback)
- localStorage for persistence
- Existing project styling patterns

## Notes for Developers

1. **localStorage Quota:** Snapshots store base64 data URLs which can be large. The system limits to 20 snapshots and handles quota exceeded errors by removing oldest entries.

2. **Memory Considerations:** Gallery images are displayed as thumbnails using the full data URL. For very large galleries, consider implementing actual thumbnail generation.

3. **Data Migration:** If the data structure changes in the future, consider adding migration logic in the hooks' load effects.

4. **Privacy Note:** All data is stored locally in the browser. No data is sent to any server.

---

## New Features: Rearview Mirror & Windshield Wipers

### 4. ✅ Functional Rearview Mirror
**Status:** Fully Implemented

**Description:**
The rearview mirror now shows the actual Street View from behind the car (180° offset from the current heading). It samples from the Street View canvas and displays it in the mirror with realistic effects including:
- Horizontal flip for mirror reflection
- Chromatic aberration for lens distortion
- Night vision mode support
- Frame skipping for performance (renders every 2nd frame)

**How to Use:**
1. Enter car mode by clicking **"🚗 Standard"** button (or press C key)
2. Look up at the rearview mirror on the windshield
3. The mirror shows the view from behind the car
4. As you drive/turn, the mirror updates to always show what's behind

**Technical Details:**
- File: `src/car/RearviewMirror.ts` - Complete rewrite
- Creates a `CanvasTexture` from the Street View canvas
- Uses a temporary scene with a plane to sample the rear view (180° offset)
- Applies custom shader material with chromatic aberration and mirror tint
- Updates every 2nd frame for performance (skipFrame = true)

**API Changes:**
```typescript
// Set the Street View canvas source
mirror.setStreetViewCanvas(canvas: HTMLCanvasElement | null)

// Update with car heading to show rear view
mirror.update(carHeading: number, skipFrame?: boolean)
```

---

### 5. ✅ Animated Windshield Wipers
**Status:** Fully Implemented

**Description:**
Windshield wipers are now integrated into the rain shader. When rain is enabled:
- Wipers automatically sweep back and forth across the windshield
- They "clear" rain drops in their path (masking the rain effect)
- Visual wiper blade is rendered on screen
- Wiper speed increases with rain intensity
- Manual toggle button in dashboard when raining

**How to Use:**
1. Enter car mode
2. Increase rain intensity using the **"🌧️ Rain"** slider in the dashboard
3. When rain > 0, a **"🧹 Wipers"** button appears
4. Click to toggle wipers ON/OFF
5. Watch the wipers sweep and clear the rain!

**Technical Details:**
- File: `public/shaders/carview.wgsl` - Added wiper functions
- Functions added:
  - `wiperMask()` - Calculates rain clearing mask based on wiper position
  - `wiperBlade()` - Renders the visual wiper blade
- Auto-enabled when rain > 0, can be manually toggled
- Speed scales with rain intensity (2.0 + rainIntensity * 2.0)
- Uses sine wave for smooth oscillating motion

**Shader Uniforms:**
```wgsl
// Wiper parameters derived from rain intensity
let wiperEnabled = rainIntensity > 0.1 ? 1.0 : 0.0;
let wiperSpeed = 2.0 + rainIntensity * 2.0;
```

**Car Mode API Changes:**
```typescript
// In src/car/index.ts
export function toggleWipers(): boolean
export function setWiperSpeed(speed: number): void
export function getWiperState(): { enabled: boolean; speed: number }
```

**UI Integration:**
- DashboardUI now accepts `onToggleWipers`, `wipersEnabled`, and `rainIntensity` props
- Wiper button only appears when `rainIntensity > 0`
- Button shows 🧹 ON or 🧹 OFF state

---

### Modified Files

1. **src/car/RearviewMirror.ts** - Complete rewrite for functional mirror
2. **src/car/index.ts** - Added wiper state and functions, updated `setMirrorStreetViewCanvas`
3. **src/car/DashboardUI.tsx** - Added wiper toggle button
4. **src/App.tsx** - Integrated mirror canvas updates, added wiper state and handlers
5. **public/shaders/carview.wgsl** - Added wiper mask and blade rendering

### Performance Considerations

**Rearview Mirror:**
- Renders every 2nd frame (30fps instead of 60fps)
- Uses 512x256 render target (half resolution)
- Creates temporary scene each frame (could be optimized with object pooling)

**Windshield Wipers:**
- Pure shader implementation (no additional draw calls)
- Wiper mask reduces rain fragment shader work in cleared areas
- No performance impact when wipers disabled

---

*Last Updated: 2026-02-24*
