# WebGPU StreetView Feature Expansion Plan (archived)

> **Archived:** This roadmap is retained for historical context. For current architecture, workflows, and active work, use **[AGENTS.md](../AGENTS.md)** and the `tasks/` directory.

---

# WebGPU StreetView Feature Expansion Plan

## Overview
This document outlines a prioritized roadmap for expanding the WebGPU StreetView application's features. Based on the existing codebase and user needs, we've categorized features by implementation priority and estimated complexity.

---
## Current Features (Implemented)
- ✅ Interactive 360° panoramic Street View navigation
- ✅ WebGPU-based rendering with custom shaders
- ✅ Mouse/keyboard controls for pan, zoom, and movement
- ✅ Cruise mode (automatic navigation)
- ✅ Route plotting and following via Google Directions API
- ✅ Mini-map with current location and route visualization
- ✅ Radio integration
- ✅ Enhanced snapshot/screenshot functionality with metadata
- ✅ North indicator compass overlay
- ✅ Fixed input event hijacking (scoped event handling)

---

## High Priority Features (Implement First)

### 1. Enhanced Snapshot System
**Complexity: Medium** | **Impact: High** | **Status: Partially Implemented**

#### 1.1 EXIF Metadata Embedding ⬜
**Technical Approach:**
- **Library:** Use `piexifjs` (`npm i piexifjs`) for client-side EXIF manipulation
- **Implementation Steps:**
  1. Convert canvas data URL to JPEG Blob with `canvas.toBlob()`
  2. Read EXIF from Blob using `piexif.load()`
  3. Set GPS tags:
     - `GPSLatitudeRef` (N/S)
     - `GPSLatitude` ([degrees, minutes, seconds])
     - `GPSLongitudeRef` (E/W)
     - `GPSLongitude` ([degrees, minutes, seconds])
     - `GPSTimeStamp` (UTC time)
     - `UserComment` (JSON string with heading, pitch, zoom, panoId)
  4. Generate new JPEG with `piexif.insert()`
  5. Trigger download via `URL.createObjectURL()`

**Code Skeleton:**
```typescript
import * as piexif from 'piexifjs';

const embedExifData = async (dataUrl: string, metadata: SnapshotMetadata) => {
  const jpeg = atob(dataUrl.split(',')[1]);
  const exifObj = piexif.load(jpeg);
  
  // Convert decimal degrees to DMS format
  const latDMS = decimalToDMS(metadata.location.lat);
  const lngDMS = decimalToDMS(metadata.location.lng);
  
  exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = metadata.location.lat >= 0 ? 'N' : 'S';
  exifObj.GPS[piexif.GPSIFD.GPSLatitude] = latDMS;
  exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = metadata.location.lng >= 0 ? 'E' : 'W';
  exifObj.GPS[piexif.GPSIFD.GPSLongitude] = lngDMS;
  exifObj.Exif[piexif.ExifIFD.UserComment] = JSON.stringify(metadata);
  
  const exifBytes = piexif.dump(exifObj);
  return piexif.insert(exifBytes, dataUrl);
};
```

**Alternative (PNG Text Chunks):**
- Use `png-chunks-extract` and `png-chunks-encode` for PNG metadata
- Store metadata in `tEXt` chunks with key `WebGPUSnapshot`

#### 1.2 Snapshot Gallery Viewer ⬜
**Architecture:**
- **Storage:** IndexedDB wrapper via `idb` library (`npm i idb`)
- **Schema:**
  ```typescript
  interface GalleryDB {
    snapshots: {
      id: string;
      thumbnail: Blob; // 200x200 WebP
      fullImage: Blob; // Original PNG
      metadata: SnapshotMetadata;
      createdAt: Date;
      tags: string[];
    };
  }
  ```

**UI Components:**
- `<SnapshotGallery />` - Main gallery container
- `<SnapshotThumbnail />` - Lazy-loaded thumbnail with intersection observer
- `<SnapshotDetail />` - Modal for full image view with metadata display
- `<SnapshotFilters />` - Date range, location search, tag filter

**Performance Considerations:**
- Thumbnails: 200x200 WebP, ~20KB each
- Lazy loading with `react-intersection-observer`
- Virtual scrolling for large collections (>100 items)

#### 1.3 Share Functionality ⬜
**Web Share API:**
```typescript
const shareSnapshot = async (files: File[], metadata: SnapshotMetadata) => {
  const shareData: ShareData = {
    title: `StreetView at ${metadata.location.description}`,
    text: `Check out this view! 📍 ${metadata.location.lat.toFixed(4)}, ${metadata.location.lng.toFixed(4)}`,
    url: generateShareableLink(metadata),
    files: files.filter(f => navigator.canShare({ files: [f] }))
  };
  
  if (navigator.share) {
    await navigator.share(shareData);
  } else {
    // Fallback: Copy to clipboard
    await navigator.clipboard.writeText(shareData.url);
    toast.success('Link copied to clipboard!');
  }
};
```

**Social Media Deep Links:**
- Twitter: `https://twitter.com/intent/tweet?url={url}&text={text}`
- Facebook: `https://www.facebook.com/sharer/sharer.php?u={url}`
- Reddit: `https://reddit.com/submit?url={url}&title={title}`

#### 1.4 Multiple Format Support ⬜
**Canvas Export Options:**
| Format | MIME Type | Quality | Use Case |
|--------|-----------|---------|----------|
| PNG | `image/png` | Lossless | Archival, editing |
| JPEG | `image/jpeg` | 0.9 | Sharing, smaller size |
| WebP | `image/webp` | 0.85 | Best compression |

**Implementation:**
```typescript
const exportFormats = [
  { id: 'png', mime: 'image/png', ext: '.png' },
  { id: 'jpeg', mime: 'image/jpeg', ext: '.jpg', quality: 0.9 },
  { id: 'webp', mime: 'image/webp', ext: '.webp', quality: 0.85 }
];

const exportSnapshot = async (format: ExportFormat) => {
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), format.mime, format.quality);
  });
  return blob;
};
```

#### 1.5 Batch Export Functionality ⬜
**Libraries:** `jszip` (`npm i jszip`) + `file-saver`

**Flow:**
1. Multi-select mode with checkboxes on thumbnails
2. "Export Selected" button triggers batch processing
3. Generate ZIP with:
   - `/images/` - All selected snapshots
   - `/metadata/` - JSON files for each image
   - `manifest.json` - Index file with all metadata
4. Download via `saveAs(zipBlob, 'streetview-snapshots.zip')`

---

### 2. Historical Imagery (Time Travel)
**Complexity: High** | **Impact: High** | **Dependencies: Google Street View Metadata API**

#### 2.1 Time Slider Control ⬜
**Data Acquisition Strategy:**
Google Street View doesn't provide a direct API for historical imagery listing. Workarounds:

**Option A: Image Date from Current Panorama**
```typescript
const getPanoramaData = async (panoId: string) => {
  const service = new google.maps.StreetViewService();
  const result = await service.getPanorama({
    pano: panoId,
    preference: google.maps.StreetViewPreference.NEAREST
  });
  return {
    imageDate: result.data.imageDate, // "2023-06"
    copyright: result.data.copyright
  };
};
```

**Option B: Nearby Panorama Crawling**
- Search panoramas within 10m radius
- Filter by different `imageDate` values
- Deduplicate by date

**UI Implementation:**
```typescript
interface HistoricalView {
  panoId: string;
  imageDate: string; // "2023-06"
  timestamp: number;
  thumbnail?: string;
}

// Range slider with date labels
<input 
  type="range" 
  min={earliestTimestamp}
  max={latestTimestamp}
  value={currentTimestamp}
  onChange={(e) => loadHistoricalView(parseInt(e.target.value))}
/>
```

#### 2.2 Side-by-Side Comparison View ⬜
**Layout Options:**
- **Vertical Split:** Two canvases side-by-side (50%/50%)
- **Horizontal Split:** Top/bottom comparison
- **Slider Overlay:** Before/after swipe comparison

**State Synchronization:**
```typescript
const [comparisonState, setComparisonState] = useState({
  leftPanoId: string;
  rightPanoId: string;
  syncPOV: boolean; // If true, both views follow same heading/pitch
  heading: number;
  pitch: number;
  zoom: number;
});
```

**Performance:** Two WebGPU contexts = double GPU memory. Consider:
- Lower resolution for secondary view
- Texture sharing if possible
- Destroy context when leaving comparison mode

#### 2.3 Timeline Visualization ⬜
**Data Visualization:**
- **Heatmap Timeline:** Dots on a timeline showing available imagery density
- **Year Grid:** Calendar-style view with thumbnails
- **Map Overlay:** Mini-map showing coverage of historical imagery

**Implementation:**
```typescript
// Aggregate available dates
const dateHistogram = historicalViews.reduce((acc, view) => {
  const year = view.imageDate.split('-')[0];
  acc[year] = (acc[year] || 0) + 1;
  return acc;
}, {} as Record<string, number>);
```

#### 2.4 Historical Data Caching ⬜
**Service Worker Strategy:**
```typescript
// sw.ts
const HISTORICAL_CACHE = 'streetview-historical-v1';

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('streetview')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((fetchResponse) => {
          return caches.open(HISTORICAL_CACHE).then((cache) => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      })
    );
  }
});
```

---

### 3. Location Features
**Complexity: Medium** | **Impact: High** | **Status: Partially Implemented (Search exists)**

#### 3.1 Enhanced Search Functionality ✅ (Implemented)
**Current Implementation:**
- Geocoding API for address/coordinate search
- Enter key support
- Error handling for "Location not found"

**Enhancements:**
- **Autocomplete:** `google.maps.places.Autocomplete` integration
- **Recent Searches:** LocalStorage persistence
- **Search Suggestions:** "Popular Locations", "Your Bookmarks"

#### 3.2 Bookmarks/Favorites System ⬜
**Data Model:**
```typescript
interface Bookmark {
  id: string;
  name: string;
  description?: string;
  panoId: string;
  position: { lat: number; lng: number };
  pov: { heading: number; pitch: number; zoom: number };
  thumbnail?: string; // Base64 or URL
  tags: string[];
  createdAt: Date;
  visitCount: number;
}
```

**Storage:** IndexedDB with `idb` library

**UI Components:**
- Bookmark button (star icon) in main controls
- Bookmark manager modal with folder organization
- Quick-access sidebar with top 5 bookmarks
- Import/Export (JSON format)

#### 3.3 Location History Tracking ⬜
**Tracking Strategy:**
```typescript
// Debounced history recording (every 5 seconds or significant movement)
useEffect(() => {
  const debouncedRecord = debounce((position, pov) => {
    historyDB.add({
      timestamp: Date.now(),
      panoId: panorama.getPano(),
      position,
      pov,
      locationName
    });
  }, 5000);
  
  if (panorama) {
    const listener = panorama.addListener('position_changed', () => {
      debouncedRecord(panorama.getPosition(), panorama.getPov());
    });
    return () => google.maps.event.removeListener(listener);
  }
}, [panorama]);
```

**History Viewer:**
- Timeline view with map trace
- "Rewind" functionality to jump to previous locations
- Session replay (auto-navigate through history)
- Export as GPX file

#### 3.4 POI Overlay ⬜
**Data Sources:**
- Google Places API (Nearby Search)
- Custom POI database
- Wikipedia API for landmarks

**Implementation:**
```typescript
const fetchNearbyPOIs = async (position: google.maps.LatLng, radius: number) => {
  const service = new google.maps.places.PlacesService(document.createElement('div'));
  
  return new Promise<POI[]>((resolve) => {
    service.nearbySearch({
      location: position,
      radius,
      type: ['tourist_attraction', 'restaurant', 'museum', 'park']
    }, (results) => {
      resolve(results?.map(r => ({
        id: r.place_id,
        name: r.name,
        position: r.geometry?.location,
        rating: r.rating,
        types: r.types,
        photo: r.photos?.[0]?.getUrl()
      })) || []);
    });
  });
};
```

**Visualization:**
- Mini-map markers for POIs
- Sidebar list with distance sorting
- Category filters (Food, Attractions, Shopping, etc.)
- Click to navigate to POI location

#### 3.5 Nearby Places Search and Filtering ⬜
**Search Interface:**
- Text search with category dropdown
- Distance slider (100m - 5km)
- Rating filter (★★★★★)
- Open now toggle

**Results Display:**
- Card grid with images
- Sort options: Distance, Rating, Name
- Quick actions: Navigate, Save, Share

---

### 4. AR/Compass Integration
**Complexity: Low** | **Impact: Medium** | **Status: Partially Implemented**

#### 4.1 Digital Compass ✅ (Implemented)
**Current Features:**
- SVG compass rose with rotating needle
- North indicator (red arrow)
- Heading degree display
- Green accent theme matching

**Enhancements:**
- Cardinal direction text (N, NE, E, etc.)
- Magnetic vs True North toggle
- Compass calibration warning

#### 4.2 Device Orientation Integration ⬜
**Mobile AR Feature:**
```typescript
const useDeviceOrientation = () => {
  const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0 });
  
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      setOrientation({
        alpha: e.alpha || 0,   // Z-axis (compass direction)
        beta: e.beta || 0,     // X-axis (front-to-back tilt)
        gamma: e.gamma || 0    // Y-axis (left-to-right tilt)
      });
    };
    
    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, []);
  
  return orientation;
};
```

**AR Mode:**
- Request permission: `DeviceOrientationEvent.requestPermission()` (iOS 13+)
- Overlay POI markers on canvas based on device heading
- Show "Point device North to align" helper

#### 4.3 Always-Visible Coordinate Display ⬜
**HUD Component:**
```typescript
const LocationHUD: React.FC = () => (
  <div className="location-hud">
    <div>📍 {lat.toFixed(6)}, {lng.toFixed(6)}</div>
    <div>🧭 {heading.toFixed(0)}° {getCardinalDirection(heading)}</div>
    <div>📐 Pitch: {pitch.toFixed(0)}°</div>
    <div>🔍 Zoom: {zoom.toFixed(1)}x</div>
  </div>
);
```

---

## Medium Priority Features

### 5. Measurement Tools
**Complexity: Medium** | **Impact: Medium**

#### 5.1 Distance Measurement ⬜
**Approach:** Since Street View doesn't expose 3D world coordinates, use:
1. **Haversine Formula** for ground-level distance between two lat/lng points
2. **Pixel-based estimation** using known Street View camera parameters

**UI Flow:**
1. Click "Measure Distance" button
2. Click point A on minimap or current view
3. Click point B (or use current position)
4. Display distance with unit toggle (m/km/ft/mi)

```typescript
const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
};
```

#### 5.2 Area Calculation ⬜
**Polygon Drawing:**
- Click multiple points on minimap to define polygon vertices
- Visual feedback with connecting lines
- Calculate area using shoelace formula

#### 5.3 Elevation Profile ⬜
**Data Source:** Google Maps Elevation API
```typescript
const getElevationProfile = async (path: google.maps.LatLng[]) => {
  const elevator = new google.maps.ElevationService();
  const { results } = await elevator.getElevationAlongPath({
    path,
    samples: 256
  });
  return results.map(r => ({
    location: r.location,
    elevation: r.elevation
  }));
};
```

**Visualization:**
- Line chart using Chart.js or SVG
- Show elevation gain/loss statistics
- Highlight steep sections

---

### 6. Customization & Settings
**Complexity: Low** | **Impact: Medium**

#### 6.1 Theme Options ⬜
**CSS Variables Approach:**
```css
:root {
  --bg-primary: #1a1a1a;
  --bg-secondary: #2a2a2a;
  --accent-color: #4CAF50;
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
}

[data-theme="light"] {
  --bg-primary: #f5f5f5;
  --bg-secondary: #ffffff;
  --text-primary: #333333;
  --text-secondary: #666666;
}
```

**Presets:**
- Dark (default)
- Light
- High Contrast
- OLED Black (pure #000 background)

#### 6.2 Performance Settings ⬜
**Options:**
- **Rendering Quality:** Low/Medium/High (affects WebGPU texture resolution)
- **FPS Limit:** 30/60/Unlimited
- **Field of View:** 60°-120° slider
- **Texture Filtering:** Bilinear/Trilinear/Nearest

#### 6.3 Customizable Keyboard Shortcuts ⬜
**Settings Schema:**
```typescript
interface KeyBinding {
  action: 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight' | 'zoomIn' | 'zoomOut' | 'toggleMap' | 'takeSnapshot';
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift')[];
}

const defaultBindings: KeyBinding[] = [
  { action: 'moveForward', key: 'w', modifiers: [] },
  { action: 'moveLeft', key: 'a', modifiers: [] },
  { action: 'moveBackward', key: 's', modifiers: [] },
  { action: 'moveRight', key: 'd', modifiers: [] },
];
```

**UI:**
- Press key to bind interface
- Conflict detection
- Reset to defaults button

#### 6.4 Control Sensitivity ⬜
**Sliders:**
- Mouse pan sensitivity (0.1x - 3x)
- Mouse wheel zoom sensitivity
- Keyboard movement repeat rate
- Smoothing factor (0-1, for input interpolation)

#### 6.5 UI Layout Customization ⬜
**Options:**
- Mini-map position: Top-Right/Bottom-Right/Top-Left/Bottom-Left
- Compass position toggle
- HUD element visibility toggles
- Control bar auto-hide delay

---

### 7. Collaboration & Sharing
**Complexity: Medium** | **Impact: Medium**

#### 7.1 Shareable Links ✅ (Implemented)
**Current:** URL params with lat/lng/heading/pitch

**Enhancement:**
- Short URL generation via bit.ly API or custom shortener
- QR code generation for mobile sharing
- Preview image generation for social cards

#### 7.2 Annotation Tools ⬜
**Types:**
- **Markers:** Pin drops with labels
- **Notes:** Text annotations attached to specific views
- **Drawings:** Freehand SVG overlays on canvas
- **Measurements:** Saved distance/area measurements

**Storage:** Per-panorama annotation database (IndexedDB)

#### 7.3 Tour Creation and Playback ⬜
**Tour Format:**
```typescript
interface Tour {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  waypoints: TourWaypoint[];
  autoPlaySpeed: number; // seconds per waypoint
  transitionType: 'instant' | 'fade' | 'fly';
}

interface TourWaypoint {
  panoId: string;
  position: { lat: number; lng: number };
  pov: { heading: number; pitch: number; zoom: number };
  dwellTime: number; // milliseconds to stay at this point
  annotation?: string; // Optional narration/text
}
```

**Playback Features:**
- Play/Pause/Stop controls
- Progress bar with scrubbing
- Speed control (0.5x - 2x)
- Full-screen mode

#### 7.4 Tour Export/Import ⬜
**Formats:**
- JSON (native format)
- KML (Google Earth compatible)
- GPX (GPS devices)
- Video export (WebRTC recording)

#### 7.5 Waypoint Management ⬜
**Features:**
- Add current view as waypoint
- Reorder waypoints (drag & drop)
- Edit waypoint properties (POV, dwell time)
- Bulk import from file

---

### 8. Offline Mode
**Complexity: High** | **Impact: Medium** | **Status: Phase 1–2 implemented, Phase 3 scaffold**

#### 8.1 Cache Management ✅ (partial)
**Storage Strategy:**
- **Panorama Images:** ❌ Not cached (Maps Platform ToS) — metadata + link graph only
- **Route Data:** 🚧 Phase 3 scaffold (`src/offline/routePrefetch.ts`)
- **Metadata:** ✅ IndexedDB stores bookmarks, history, tours, snapshots, pano metadata

**Implementation:** `public/service-worker.js` + `src/offline/` (see README § Offline Mode)

**Quota Management:**
```typescript
const estimateStorage = async () => {
  const estimate = await navigator.storage.estimate();
  const usedGB = (estimate.usage || 0) / 1024 / 1024 / 1024;
  const quotaGB = (estimate.quota || 0) / 1024 / 1024 / 1024;
  return { usedGB, quotaGB, percentUsed: (usedGB / quotaGB) * 100 };
};
```

**Cache Policies:**
- LRU (Least Recently Used) eviction
- Priority levels: Favorites > Recent > Route > General
- Manual cache cleanup UI

#### 8.2 Offline Snapshot Gallery ✅
- All snapshots available offline (IndexedDB + localStorage mirror)
- Thumbnail regeneration on demand
- Metadata search/filtering

#### 8.3 Downloadable Route Data ✅
**Pre-download workflow (implemented via the Tours panel's "Prepare offline graph"):**
1. User selects a saved tour (its waypoints double as the route)
2. `prefetchRouteGraph` walks each waypoint via `StreetViewService`, snapping to the nearest panorama
3. Progress is reported per waypoint (`RoutePrefetchProgress`) and shown in the Tours panel
4. Pano IDs + link IDs (never imagery) are stored in IndexedDB under `routeGraph`, keyed by `${routeId}:${panoId}`
5. The Offline storage panel lists prepared graphs by node count and supports deleting them
6. Cruise mode and tour playback consult the graph (`src/offline/routeGraphNavigation.ts`) to pre-warm the likely next panorama when online but flaky; no fake panoramas are shown when truly offline

#### 8.4 Offline POI Data ⬜
- Wikipedia articles for landmarks (offline package)
- Basic POI database for major cities
- User-generated annotations (always available)

---

## Low Priority Features (Future Exploration)

### 9. Advanced Rendering Effects
**Complexity: High** | **Impact: Low**

#### 9.1 Weather Effects ⬜
**WebGPU Particle Systems:**
- **Rain:** 10,000+ particle system with collision
- **Snow:** Slower falling particles with accumulation simulation
- **Fog:** Volumetric fog shader with density control

**Implementation:**
```wgsl
// Rain vertex shader snippet
@vertex
fn vs_main(@location(0) position: vec3<f32>, @location(1) velocity: vec3<f32>) -> VertexOutput {
    var out: VertexOutput;
    let time = uniforms.time;
    let worldPos = position + velocity * time % 100.0; // Loop rain drops
    out.position = viewProj * vec4<f32>(worldPos, 1.0);
    return out;
}
```

#### 9.2 Time of Day Lighting ⬜
**Sun Position Calculation:**
```typescript
import { SunCalc } from 'suncalc3';

const getSunPosition = (lat: number, lng: number, date: Date) => {
  return SunCalc.getPosition(date, lat, lng);
};
```

**Shader Adjustments:**
- Color temperature shifts (warm at sunrise/sunset, cool at midday)
- Shadow intensity
- Ambient occlusion

#### 9.3 Custom Filters ⬜
**Post-Processing Pipeline:**
- Brightness/Contrast/Saturation
- Vignette effect
- Film grain
- HDR tone mapping
- Night vision
- Black & white

#### 9.4 3D Object Placement ⬜
**Use Cases:**
- Virtual signage for businesses
- Historical reconstruction overlays
- Architectural visualization

**Technical:** GLTF model loading into WebGPU scene

---

### 10. Day/Night Cycle
**Complexity: Medium** | **Impact: Medium**

#### 10.1 Real-Time Sun Position ⬜
**Calculation:**
```typescript
import * as SunCalc from 'suncalc';

const updateSunPosition = () => {
  const times = SunCalc.getTimes(new Date(), lat, lng);
  const position = SunCalc.getPosition(new Date(), lat, lng);
  
  // Convert altitude/azimuth to shader uniforms
  const sunUniforms = {
    altitude: position.altitude,
    azimuth: position.azimuth,
    isDaytime: Date.now() > times.sunrise && Date.now() < times.sunset
  };
};
```

#### 10.2 Dynamic Lighting Adjustments ⬜
**Shader Implementation:**
- Adjust color grading based on sun altitude
- Blue hour (twilight) color shift
- Night mode with artificial lighting simulation

#### 10.3 Manual Time Override ⬜
**UI:**
- 24-hour slider
- "Now" button to return to current time
- Play button for time-lapse effect

#### 10.4 Scheduled Transitions ⬜
- Auto-advance time during cruise mode
- Speed control (real-time, 10x, 100x, 1000x)
- Transition effects between day/night

---

### 11. Traffic Layer Integration
**Complexity: Medium** | **Impact: Medium**

#### 11.1 Real-Time Traffic Overlay ⬜
**Google Maps Traffic Layer:**
```typescript
// Add to MiniMap component
const trafficLayer = new google.maps.TrafficLayer();
trafficLayer.setMap(map);
```

#### 11.2 Traffic Density Indicators ⬜
- Color coding on route path (green/yellow/red)
- Congestion warnings
- Estimated delay display

#### 11.3 Traffic-Aware Routing ⬜
```typescript
const request: google.maps.DirectionsRequest = {
  origin,
  destination,
  travelMode: google.maps.TravelMode.WALKING,
  drivingOptions: {
    departureTime: new Date(), // Now
    trafficModel: google.maps.TrafficModel.BEST_GUESS
  }
};
```

#### 11.4 Historical Traffic Patterns ⬜
- Day/time based typical traffic
- Commute pattern recommendations

---

### 12. Street-Level Weather
**Complexity: High** | **Impact: Medium**

#### 12.1 Weather API Integration ⬜
**Provider Options:**
- OpenWeatherMap (free tier: 1000 calls/day)
- WeatherAPI.com
- Visual Crossing

**Data Points:**
- Temperature, humidity, wind
- Condition code (clear, rain, snow, fog)
- Visibility distance

#### 12.2 Weather-Matched Shaders ⬜
**Condition Mapping:**
| Weather | Shader Effect |
|---------|--------------|
| Clear | Bright, slight saturation boost |
| Rain | Particle system + wet surface reflections |
| Snow | Particle system + color temperature shift |
| Fog | Volumetric fog + reduced visibility |
| Cloudy | Flat lighting, desaturation |
| Night | Blue shift, artificial lighting |

#### 12.3 Weather Display ⬜
- Temperature overlay
- Wind direction arrow
- Condition icon
- Forecast timeline

#### 12.4 Ambient Effects ⬜
- Weather-appropriate sound effects (rain, wind)
- Volume based on intensity

---

### 13. Voice Navigation
**Complexity: Medium** | **Impact: Medium**

#### 13.1 Text-to-Speech ⬜
**Web Speech API:**
```typescript
const speak = (text: string) => {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.voice = speechSynthesis.getVoices().find(v => v.lang === 'en-US');
  speechSynthesis.speak(utterance);
};

// Announce turn
speak(`Turn left in 50 meters`);
```

#### 13.2 Voice Commands ⬜
**Web Speech Recognition API:**
```typescript
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.interimResults = false;

recognition.onresult = (event) => {
  const command = event.results[event.results.length - 1][0].transcript.toLowerCase();
  
  if (command.includes('forward') || command.includes('go')) {
    onMove('forward');
  } else if (command.includes('left')) {
    onMove('left');
  } else if (command.includes('right')) {
    onMove('right');
  } else if (command.includes('zoom in')) {
    onZoom(-100);
  }
};

recognition.start();
```

**Commands:**
- "Move forward/backward/left/right"
- "Turn [direction]"
- "Zoom in/out"
- "Open/Close map"
- "Take snapshot"
- "Start/Stop cruise"

#### 13.3 Audio Cues ⬜
- Beep on waypoint approach
- Different tones for different actions
- Spatial audio (optional)

---

### 14. Social Features
**Complexity: High** | **Impact: Low**

#### 14.1 User Photo Uploads ⬜
**Requirements:**
- Image validation (360° detection)
- EXIF GPS extraction
- Moderation queue
- Storage backend (Firebase/S3)

#### 14.2 Reviews and Comments ⬜
- Star ratings
- Text reviews
- Photo attachments
- Vote system

#### 14.3 Shared Exploration Sessions ✅ (text chat overlay still ⬜)
**WebRTC signaled via Supabase Realtime:**
- ✅ Host creates a session room — 6-character room code, no server-side persistence (rooms "expire" the moment everyone leaves)
- ✅ Guests join via code — signaling handshake (SDP/ICE) goes through a Realtime broadcast channel keyed by the code; media stays peer-to-peer over WebRTC
- ✅ Synchronized navigation — host broadcasts POV at 10Hz, guests apply it seq-ordered (`shouldApplyIncomingState`)
- ✅ Host controls with guest following, live room roster via Realtime presence, multi-guest hub topology, automatic reconnect retry (capped) on a dropped peer connection
- ⬜ Text chat overlay — not built
- ⬜ TURN server — STUN-only for now; see README "Shared Exploration Sessions" for how to add one

#### 14.4 Content Moderation ⬜
- Report button
- Auto-filtering
- Moderator dashboard

---

### 15. Data Visualization
**Complexity: Medium** | **Impact: Low**

#### 15.1 Heatmaps ⬜
**Data Sources:**
- Traffic density (Google Maps API)
- Population density (Census data)
- Air quality (PurpleAir, IQAir)
- Crime statistics

**Visualization:**
- Overlay on mini-map
- Legend and color scale
- Time-based animation

#### 15.2 Route Recording and Replay ⬜
- Record exact path taken
- Speed/heading over time graph
- Export as video

#### 15.3 Exploration Statistics ⬜
**Dashboard:**
- Total distance explored
- Countries/States visited
- Time spent in Street View
- Favorite locations
- Snapshot count
- Achievements/Badges

#### 15.4 Custom Data Layer ⬜
- Import GeoJSON/KML
- Custom marker rendering
- Toggle visibility

---

### 16. Accessibility Improvements
**Complexity: Medium** | **Impact: Medium**

#### 16.1 Screen Reader Support ⬜
- ARIA labels on all controls
- Live regions for navigation announcements
- Keyboard focus indicators

#### 16.2 Keyboard-Only Navigation ⬜
- Tab order optimization
- Arrow key panning
- +/- zoom keys
- Enter to move forward

#### 16.3 High Contrast Mode ⬜
```css
@media (prefers-contrast: high) {
  .control-btn {
    border: 2px solid white;
    background: black;
    color: white;
  }
}
```

#### 16.4 UI Scaling ⬜
- Font size slider (12px - 24px)
- UI element scaling
- Touch target size options

---

## Technical Improvements

### Performance Optimizations
**Complexity: Medium** | **Impact: High**

#### WebGPU Shader Pipeline Optimizations ⬜
- **Bind Group Reuse:** Minimize bind group creation in render loop
- **Uniform Buffer Streaming:** Use ring buffer for uniform updates
- **Texture Atlas:** Combine small textures into single atlas
- **Mipmap Generation:** Pre-generate mipmaps for better performance

#### Texture Streaming ⬜
- **LOD System:** Load lower resolution tiles first, then upscale
- **Priority Queue:** Load textures in view direction first
- **Compression:** Use BC/ETC compression formats

#### Performance Monitoring ⬜
```typescript
const useFPSMonitor = () => {
  const [fps, setFps] = useState(60);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  
  useEffect(() => {
    let rafId: number;
    
    const loop = () => {
      frameCount.current++;
      const now = performance.now();
      
      if (now - lastTime.current >= 1000) {
        setFps(frameCount.current);
        frameCount.current = 0;
        lastTime.current = now;
      }
      
      rafId = requestAnimationFrame(loop);
    };
    
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);
  
  return fps;
};
```

#### Progressive Loading ⬜
- Blur-up placeholder while loading high-res
- Interleaved texture updates
- Background thread decoding (Web Workers)

---

### Code Quality & Testing
**Complexity: Medium** | **Impact: High**

#### Unit Test Suite ⬜
**Framework:** Vitest or Jest

**Coverage Areas:**
- Navigation logic (`findBestLink`)
- Coordinate calculations (Haversine formula)
- Utility functions
- State reducers

```typescript
// Example test
describe('findBestLink', () => {
  it('should select forward link when heading matches', () => {
    const links = [
      { heading: 0, pano: 'forward' },
      { heading: 180, pano: 'backward' }
    ];
    expect(findBestLink(links, 0, 'forward')).toBe('forward');
  });
});
```

#### Integration Tests ⬜
- Full navigation workflow
- Snapshot capture flow
- Route planning end-to-end
- Settings persistence

#### Error Handling Improvements ⬜
- **Canvas Scraping:** Retry logic with exponential backoff
- **API Failures:** Graceful degradation with user notification
- **WebGPU Context Loss:** Automatic recovery
- **Network Errors:** Offline mode fallback

```typescript
const withRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delay = 1000
): Promise<T> => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries exceeded');
};
```

#### TypeScript Strict Mode ⬜
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

---

### Infrastructure
**Complexity: Low** | **Impact: Medium**

#### CI/CD Pipeline ⬜
**GitHub Actions Workflow:**
```yaml
name: CI/CD
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build
      - run: npm run type-check
```

#### Automated Deployment ⬜
- **Staging:** Auto-deploy on PR merge to `develop`
- **Production:** Manual approval for `main` branch
- **Preview:** Deploy PRs to unique URLs for review

#### Environment Variable Management ⬜
```typescript
// config.ts
export const config = {
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  apiBaseUrl: import.meta.env.VITE_API_URL || 'https://api.default.com',
  enableAnalytics: import.meta.env.VITE_ENABLE_ANALYTICS === 'true'
} as const;
```

**Security:**
- Never commit `.env` files
- Use different keys for dev/staging/prod
- Restrict API key domains in Google Cloud Console

#### Bundle Size Optimization ⬜
**Analysis:**
```bash
npm run build -- --analyze
```

**Techniques:**
- Code splitting by route
- Tree shaking
- Dynamic imports for heavy libraries
- Compression (Brotli/Gzip)

**Target Budgets:**
- Initial JS: < 200KB gzipped
- WebGPU shaders: Lazy loaded
- Total first load: < 500KB

---

## Implementation Guidelines

### Development Phases

#### Phase 1 (Q1 2026): Foundation & Core Features
- ✅ Enhanced Snapshots (JSON sidecar)
- ⬜ EXIF metadata embedding
- ✅ AR/Compass Integration
- ✅ Input event hijacking fix
- ⬜ Performance monitoring
- ⬜ Settings system

#### Phase 2 (Q2 2026): Advanced Navigation
- ⬜ Historical Imagery
- ⬜ Bookmarks system
- ⬜ Location history
- ⬜ Measurement tools
- ⬜ POI integration

#### Phase 3 (Q3 2026): Collaboration & Offline
- ⬜ Tour creation/playback
- ⬜ Annotation system
- ⬜ Offline mode
- ⬜ Share enhancements
- ⬜ Voice navigation

#### Phase 4 (Q4 2026): Advanced Features
- ⬜ Weather effects
- ⬜ Day/night cycle
- ⬜ Social features
- ⬜ Data visualization
- ⬜ Mobile app (PWA/Capacitor)

---

### Technical Considerations

#### WebGPU Compatibility
- **Feature Detection:** Graceful fallback to Canvas 2D or WebGL
- **Adapter Limits:** Query and respect device limits
- **Shader Compilation:** Cache compiled shaders in IndexedDB

#### Google Maps API Compliance
- **Terms of Service:** Review for screenshot/sharing features
- **Rate Limits:** Implement exponential backoff
- **Attribution:** Display required copyright notices
- **Caching:** Follow tile caching guidelines

#### Progressive Enhancement
```typescript
const getRenderer = async () => {
  if (navigator.gpu) {
    return new WebGPURenderer();
  }
  if (window.WebGL2RenderingContext) {
    return new WebGL2Renderer();
  }
  return new Canvas2DRenderer();
};
```

#### Error Handling Strategy
1. **Detection:** Identify error type
2. **Recovery:** Attempt automatic recovery
3. **Fallback:** Switch to degraded mode
4. **Notification:** Inform user with actionable message
5. **Logging:** Send to error tracking service

#### Mobile Responsiveness
- **Touch Controls:** Virtual joystick, pinch-to-zoom
- **Orientation:** Handle device rotation
- **Performance:** Reduce quality on low-end devices
- **Battery:** Throttle when battery is low

---

### Success Metrics

#### User Engagement
| Metric | Target | Measurement |
|--------|--------|-------------|
| Session Duration | > 5 min | Analytics |
| Features Used/Session | > 3 | Event tracking |
| Return Rate | > 30% weekly | Cohort analysis |
| Snapshot Creation | > 100/day | Database |
| Tour Playback | > 50/day | Database |

#### Performance Benchmarks
| Metric | Target | Measurement |
|--------|--------|-------------|
| First Contentful Paint | < 1.5s | Lighthouse |
| Time to Interactive | < 3s | Lighthouse |
| FPS (WebGPU) | > 55 | Custom monitor |
| Memory Usage | < 200MB | Chrome DevTools |
| Bundle Size | < 200KB | Build analysis |

#### Code Quality
| Metric | Target | Tool |
|--------|--------|------|
| Test Coverage | > 80% | Vitest + Istanbul |
| Type Safety | 100% strict | TypeScript |
| Lint Errors | 0 | ESLint |
| Bundle Duplication | < 5% | webpack-bundle-analyzer |

#### Accessibility
| Metric | Target | Tool |
|--------|--------|------|
| Lighthouse A11y Score | 100 | Lighthouse |
| Keyboard Navigation | Full | Manual test |
| Screen Reader | Compatible | NVDA/VoiceOver |
| Color Contrast | WCAG AA | axe-core |

---

## Appendix A: API References

### Google Maps JavaScript API
- **StreetViewService:** `getPanorama()`, `getPanoramaByLocation()`
- **StreetViewPanorama:** `setPano()`, `setPov()`, `setPosition()`
- **DirectionsService:** `route()`
- **PlacesService:** `nearbySearch()`, `getDetails()`
- **ElevationService:** `getElevationAlongPath()`

### WebGPU API
- **GPUDevice:** `createRenderPipeline()`, `createBuffer()`, `createTexture()`
- **GPUCanvasContext:** `configure()`, `getCurrentTexture()`
- **GPUQueue:** `writeBuffer()`, `copyExternalImageToTexture()`

### Web APIs
- **IndexedDB:** Object stores, cursors, transactions
- **Service Worker:** `caches`, `fetch` interception
- **Web Share API:** `navigator.share()`
- **Fullscreen API:** `requestFullscreen()`, `exitFullscreen()`

---

## Appendix B: Third-Party Libraries

### Core Dependencies (Already in Use)
- `react` / `react-dom` - UI framework
- `typescript` - Type safety
- `webpack` - Build tool

### Recommended Additions

#### Data & Storage
| Library | Purpose | Size |
|---------|---------|------|
| `idb` | IndexedDB wrapper | ~1KB |
| `jszip` | ZIP file generation | ~95KB |
| `piexifjs` | EXIF manipulation | ~25KB |

#### Visualization
| Library | Purpose | Size |
|---------|---------|------|
| `chart.js` | Charts/graphs | ~60KB |
| `chartjs-adapter-date-fns` | Date axis support | ~5KB |

#### Utilities
| Library | Purpose | Size |
|---------|---------|------|
| `date-fns` | Date manipulation | ~15KB |
| `lodash-es` | Utility functions | ~25KB (tree-shakeable) |
| `suncalc3` | Sun position calc | ~5KB |

#### Development
| Library | Purpose |
|---------|---------|
| `vitest` | Testing framework |
| `@testing-library/react` | React testing utilities |
| `playwright` | E2E testing |
| `eslint` | Linting |
| `prettier` | Code formatting |

---

*Last Updated: February 6, 2026*
*Next Review: March 6, 2026*
