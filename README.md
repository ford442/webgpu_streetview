# 🗺️ WebGPU StreetView

A high-performance Google Maps Street View viewer with an immersive 3D car interior experience, built with React, WebGPU, and Three.js.

[![React](https://img.shields.io/badge/React-19.1.1-61DAFB?logo=react)](https://react.dev/)
[![WebGPU](https://img.shields.io/badge/WebGPU-Latest-FF6B00)](https://gpuweb.github.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.160-000000?logo=three.js)](https://threejs.org/)

## ✨ Features

### Core Functionality
- 🎬 **Real-time Street View Rendering** — Captures and renders Google Maps panoramas using WebGPU
- 🎮 **Interactive Free Look** — Mouse + keyboard control for immersive 360° navigation
- 🚗 **Car Interior Mode** — Immersive vehicle experience with:
  - Interactive steering wheel animation (A/D keys)
  - Functional windshield wipers (smooth animation + toggle)
  - Live dashboard gauges (speedometer, tachometer, fuel level)
  - Reflective side mirrors
  - Toggleable headlights with spotlight effects
  - Dashboard UI with controls (GPS, radio, climate, wipers)

### Navigation & Planning
- 🛣️ **Route Planning** — Calculate walking paths using Google Directions API
- 🚀 **Cruise Mode** — Auto-navigate along routes or in straight lines
- 📍 **Bookmarks** — Save locations with custom notes and easy recall
- 📜 **History Tracking** — Breadcrumb trail of visited locations
- 🗺️ **Mini Map** — Secondary map showing current position and heading
- 🧭 **Compass** — Real-time directional indicator

### Visual Enhancements
- 🎨 **Color Grading** — Tone-mapping and color adjustment controls
- 📸 **Snapshot Gallery** — Capture and manage Street View snapshots
- ⚙️ **Performance Monitoring** — Real-time FPS and rendering metrics overlay

### Accessibility
- ⌨️ **Full Keyboard Navigation** — Complete control without mouse
- 🔊 **Screen Reader Support** — ARIA labels and announcements
- 🎯 **Customizable Shortcuts** — User-configurable keyboard bindings
- ♿ **Accessibility Panel** — UI zoom levels and view options

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm
- Modern browser with WebGPU support (Chrome 113+, Edge 113+, or experimental Firefox)
- Google Maps API key with Street View and Directions APIs enabled

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd webgpu_streetview

# Install dependencies
npm install

# Create .env file with your Google Maps API key
echo "REACT_APP_MAPS_API_KEY=your_api_key_here" > .env

# Start development server
npm start
```

The app opens at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

Optimized bundle is created in the `build/` directory.

## 🎮 Controls

### Free Look Mode (Default)

| Control | Action |
|---------|--------|
| **Mouse Drag** | Look around (heading & pitch) |
| **Scroll** | Zoom in/out |
| **W** | Move forward in heading direction |
| **A** | Turn left |
| **D** | Turn right |
| **S** | Turn around |
| **+/-** | Increase/decrease zoom |
| **R** | Reset view to default |

### Car Mode

| Control | Action |
|---------|--------|
| **A/D or ← →** | Steer wheel (left/right) |
| **W** | Move forward |
| **Mouse** | Head look (independent of steering) |
| **Scroll** | Zoom in/out |
| **Toggle Wipers** | Dashboard button or hotkey |
| **Toggle Headlights** | Dashboard button or hotkey |

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| **C** | Toggle Car Mode |
| **B** | Toggle Bookmarks |
| **H** | Toggle History |
| **P** | Toggle Performance Stats |
| **Space** | Take snapshot |
| **1-5** | Quick preset views |
| **Esc** | Close panels |

## 🏗️ Architecture

### Component Structure

```
┌─────────────────────────────────────────────┐
│              App.tsx (Controller)            │
├─────────────────────────────────────────────┤
│                                              │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ StreetView   │  │ WebGPUCanvas         │ │
│  │ (Maps Capture)│  │ (Renderer Interface) │ │
│  └──────────────┘  └──────────────────────┘ │
│           │                  │               │
│           └──────────────────┘               │
│                  │                           │
│           ┌──────▼────────┐                 │
│           │ Renderer.ts   │                 │
│           │ (WebGPU)      │                 │
│           └──────────────┘                  │
│                                              │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ CarInterior  │  │ InputHandler         │ │
│  │ (Three.js)   │  │ (Keyboard/Mouse)     │ │
│  └──────────────┘  └──────────────────────┘ │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Feature Hooks (Bookmarks, History) │   │
│  └──────────────────────────────────────┘   │
│                                              │
└─────────────────────────────────────────────┘
```

### Data Flow

1. **Initialization**: Google Maps API loads, canvas is detected and monitored
2. **User Input**: InputHandler captures keyboard/mouse events
3. **State Update**: App.tsx updates heading, pitch, zoom state
4. **View Sync**: Google Maps panorama updates to match state
5. **Canvas Scrape**: Hidden Google Maps canvas is captured
6. **GPU Upload**: Canvas pixels uploaded as WebGPU texture
7. **Render**: WGSL shaders process texture and output to screen
8. **Car Logic**: If car mode, Three.js scene overlays car interior

## 📁 Project Structure

```
src/
├── App.tsx                              # Main application controller
├── components/                          # React UI components
│   ├── WebGPUCanvas.tsx                # WebGPU renderer integration
│   ├── StreetView.tsx                  # Google Maps integration
│   ├── InputHandler.tsx                # Input processing
│   ├── VehicleSelector.tsx             # Car selection UI
│   ├── Compass.tsx                     # Directional indicator
│   ├── MiniMap.tsx                     # Secondary map
│   ├── BookmarkPanel.tsx               # Bookmark management
│   ├── HistoryPanel.tsx                # Location history
│   ├── SnapshotGallery.tsx             # Screenshot viewer
│   ├── ColorGradingPanel.tsx           # Color adjustments
│   ├── AccessibilityPanel.tsx          # Accessibility settings
│   ├── PerformanceStatsOverlay.tsx     # Performance metrics
│   ├── WelcomeModal.tsx                # First-run introduction
│   └── LoadingOverlay.tsx              # Loading states
├── car/                                 # Car interior implementation
│   ├── index.ts                        # Car mode API
│   ├── CarInterior.ts                  # 3D scene (Three.js)
│   ├── CarAnimator.ts                  # Animation loop
│   ├── SelectivePostProcessing.ts      # Dashboard rendering
│   ├── DashboardUI.tsx                 # Dashboard UI
│   └── shaders/                        # WGSL shader files
├── renderer/                            # WebGPU rendering
│   ├── Renderer.ts                     # Main renderer class
│   ├── types.ts                        # Type definitions
│   └── shaders/                        # WGSL shader files
├── hooks/                               # Custom React hooks
│   ├── useKeyboardShortcuts.tsx        # Keyboard handling
│   ├── useBookmarks.tsx                # Bookmark state
│   ├── useLocationHistory.tsx          # History state
│   ├── useSnapshots.tsx                # Snapshot state
│   ├── usePerformanceMonitor.tsx       # Performance tracking
│   └── useMobileDetect.tsx             # Mobile detection
├── utils/                               # Utility functions
│   ├── navigation.ts                   # Route planning & link finding
│   └── [helpers]                       # Helper utilities
├── style.css                           # Global styles
└── index.tsx                           # React entry point
```

## 🔧 Development

### Running Tests

```bash
npm test
```

Runs the test suite using React Testing Library.

### Debugging

**Check Canvas Detection**: Open DevTools console and look for logs in StreetView.tsx:
```javascript
console.log("Detected canvas:", canvasElement);
```

**Monitor Renderer**: Check WebGPU errors:
```javascript
// In browser console
navigator.gpu.getPreferredCanvasFormat()
```

**Performance Profiling**: Use the Performance Stats Overlay (press **P**)

### Adding New Features

1. **Create component** in `src/components/` or appropriate module
2. **Add state management** if needed (new hook in `src/hooks/`)
3. **Wire into App.tsx** - import and add to JSX
4. **Test thoroughly** - especially edge cases
5. **Document** in claude.md and commit message

## 📚 Key Documentation

- **[claude.md](claude.md)** — Development guide, hotspots, and troubleshooting
- **[DEVELOPER_CONTEXT.md](DEVELOPER_CONTEXT.md)** — Architecture deep-dive
- **[CAR_MODE_ENHANCEMENTS.md](CAR_MODE_ENHANCEMENTS.md)** — Car feature details
- **[feature_expansion_plan.md](feature_expansion_plan.md)** — Future roadmap
- **[tasks/](tasks/)** — Issue tracking and feature specifications

## 🐛 Known Issues & Limitations

### Canvas Scraping Fragility
Google Maps doesn't officially expose canvases. The app uses a heuristic (`MutationObserver` + size sorting) to find the Street View canvas. If Google changes their DOM structure, this may break.

### Input Event Hijacking
Global `InputHandler` can interfere with UI elements (panels, buttons). Remember to call `e.stopPropagation()` on overlays.

### Mobile Support
WebGPU support on mobile is limited. The app has a mobile UI fallback (`MobileUI.tsx`), but full 3D car mode requires a desktop/tablet.

### API Rate Limits
Google Maps Directions API has rate limits. Heavy route planning may trigger throttling. Check API quota in Google Cloud Console.

## 🌍 Browser Support

| Browser | Version | Status |
|---------|---------|--------|
| Chrome  | 113+    | ✅ Full support |
| Edge    | 113+    | ✅ Full support |
| Firefox | Nightly | 🟡 Experimental (enable `dom.webgpu.enabled`) |
| Safari  | TBD     | ⏳ WebGPU pending |
| Mobile  | Various | 🟡 Limited (mobile UI fallback) |

## 🔐 Security

- **API Key**: Store in `.env` file (not committed). Consider server-side proxy in production.
- **Canvas Scraping**: Only uses public panorama data from Google Maps.
- **No Data Collection**: App doesn't track user locations or behavior.
- **HTTPS Required**: WebGPU only works on secure contexts.

## 📦 Dependencies

### Core
- `react@19.1.1` — UI framework
- `three@0.160.0` — 3D graphics library
- `@webgpu/types@0.1.64` — WebGPU TypeScript definitions

### Maps & Navigation
- Google Maps JavaScript API (loaded dynamically)
- No npm package dependency (loaded from CDN)

### Testing
- `@testing-library/react@16.3.0`
- `@testing-library/jest-dom@6.8.0`

### Build
- `react-scripts@5.0.1` — Create React App scripts
- `typescript@4.9.5`
- `webpack@5` (via react-scripts)

## 🚀 Performance Tips

1. **GPU Acceleration**: Ensure WebGPU is available (`navigator.gpu` check)
2. **Texture Size**: Monitor WebGPU texture uploads (visible in DevTools)
3. **Animation Frame Rate**: Car interior uses RAF; desktop provides 60fps, mobile ~30fps
4. **Memory**: Monitor heap size in DevTools; take snapshots to offload to disk
5. **Network**: Cache map tiles and Street View imagery where possible

## 📖 Learning Resources

- **[WebGPU Specification](https://gpuweb.github.io/gpuweb/)**
- **[WGSL Shading Language](https://www.w3.org/TR/WGSL/)**
- **[Three.js Documentation](https://threejs.org/docs/)**
- **[React 19 Documentation](https://react.dev/)**
- **[Google Maps API Docs](https://developers.google.com/maps/documentation)**

## 🤝 Contributing

1. **Fork** the repository
2. **Create feature branch**: `git checkout -b claude/my-feature-<session-id>`
3. **Commit frequently**: `git commit -m "Clear, imperative messages"`
4. **Push to origin**: `git push -u origin <branch-name>`
5. **Create pull request** with detailed description

**Code Style**:
- TypeScript strict mode
- Functional React components with hooks
- Self-documenting code (minimal comments)
- 80-character line limit for readability

## 📄 License

[Specify your license here]

## 👥 Contact

For questions or issues:
- Check **claude.md** for development guidance
- Review **DEVELOPER_CONTEXT.md** for architecture
- Create an issue on GitHub for bugs
- Use discussions for feature requests

---

**Status**: 🟢 Active Development

**Last Updated**: March 11, 2026

**Current Version**: 0.1.0

**Made with ❤️ using WebGPU, React, and Three.js**
