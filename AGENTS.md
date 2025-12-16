# WebGPU StreetView - System Architecture

This project combines Google Maps Street View with WebGPU-based fluid simulation rendering to create an interactive, visually enhanced navigation experience. The system is composed of several key components working together.

## Core Components

### 1. The Renderer (`src/renderer/Renderer.ts`)

This is the main orchestrator, written in TypeScript.

* **Role**: Manages all WebGPU resources, including textures, buffers, and pipelines.
* **Interaction**: It runs a multi-pass rendering loop on every frame.
* **Input**: Receives mouse coordinates (position, delta) and the current `RenderMode` from the React UI, plus the Street View canvas as a texture source.
* **Output**: Renders the final fluid-simulated image to the WebGPU canvas.
* **Key Logic**: For the "liquid-v3" mode, it manages a "ping-pong" texture system to update the simulation's state frame-by-frame. For "streetview" mode, it directly renders the Street View panorama.

### 2. The Velocity Shader (`public/shaders/velocity.wgsl`)

This is a compute shader that simulates the physics of the fluid's motion.

* **Role**: To calculate the velocity (direction and speed) of the liquid at every point.
* **Input**: Reads the velocity state from the previous frame and receives mouse data (position, delta) from a uniform buffer.
* **Output**: Writes the new, updated velocity field to a state texture.
* **Key Logic**: It applies friction to slow the liquid down and injects new velocity based on the user's mouse drag, creating the fluid simulation effect.

### 3. The Advection Shader (`public/shaders/advection.wgsl`)

This is a compute shader that moves the image's colors based on the fluid's motion.

* **Role**: To create the visual "smearing" or "stirring" effect.
* **Input**: Reads the final velocity field calculated by the velocity shader and the color state from the previous frame. It also has access to the original, undisturbed source image from Street View.
* **Output**: Writes the new, distorted color field to a state texture.
* **Key Logic**: For each pixel, it looks "upstream" (based on the velocity vector) to find what color should be pulled into that position. It also includes a small restoring force that gently pulls the colors back to their original positions over time.

## React Components

### 4. App Component (`src/App.tsx`)

The main application orchestrator and state manager.

* **Role**: Manages global application state, coordinates between components, handles user actions.
* **State Management**: 
  - POV state (heading, pitch)
  - Navigation state (zoom, position)
  - UI state (map visibility, cruise mode, radio)
  - Street View connection status
* **Key Features**:
  - Cruise mode: Automatic forward navigation
  - Snapshot functionality: Saves current view with metadata
  - Radio integration: Plays internet radio stream
  - Transition handling: Manages panorama loading states

### 5. StreetView Component (`src/components/StreetView.tsx`)

Manages the Google Maps Street View integration.

* **Role**: Initializes and manages the Google Maps Street View panorama.
* **Responsibilities**:
  - Loads Google Maps API
  - Creates and configures Street View panorama
  - Monitors canvas availability and dimensions
  - Provides canvas to WebGPU renderer for texture capture
* **Key Logic**: Continuously polls for valid Street View canvas (with real dimensions) and notifies parent when ready.

### 6. WebGPUCanvas Component (`src/components/WebGPUCanvas.tsx`)

Wrapper for the WebGPU rendering canvas.

* **Role**: Creates and manages the WebGPU canvas element and renderer lifecycle.
* **Input**: Render mode, source canvas, pan/zoom parameters
* **Responsibilities**:
  - Initializes WebGPU renderer
  - Passes Street View canvas as texture source
  - Updates renderer state based on user interaction
  - Handles canvas resizing

### 7. InputHandler Component (`src/components/InputHandler.tsx`)

Manages user input for navigation and interaction.

* **Role**: Captures and processes user input events.
* **Input Types**:
  - Mouse drag: Pan view (change heading/pitch)
  - Mouse wheel: Zoom in/out
  - Arrow keys: Move forward/backward/left/right
  - WASD keys: Alternative movement controls
  - Right-click: Quick forward movement
* **Output**: Calls callbacks to update application state

### 8. MiniMap Component (`src/components/MiniMap.tsx`)

Displays a small overhead map showing current location.

* **Role**: Provides spatial context and allows quick teleportation.
* **Features**:
  - Shows current position with marker
  - Updates when panorama position changes
  - Allows clicking to teleport to new location
  - Shows heading indicator (optional)

### 9. Controls Component (`src/components/Controls.tsx`)

*Note: This component exists but is currently unused in favor of integrated controls in App.tsx*

## Utility Modules

### 10. Navigation Utilities (`src/utils/navigation.ts`)

* **Role**: Helper functions for Street View navigation logic.
* **Key Function**: `findBestLink` - Determines the optimal link to follow based on current heading and desired direction.

### 11. Audio Analyzer (`src/audio/AudioAnalyzer.ts`)

* **Role**: Manages audio analysis for potential audio-reactive features.
* **Note**: Currently available but not actively integrated into the UI.

## Data Flow

1. **User Input** → InputHandler → App state update
2. **State Change** → Street View panorama update
3. **Panorama Update** → Canvas pixel data changes
4. **Canvas Changes** → WebGPU texture update
5. **Texture + Mouse Data** → Velocity Shader → Advection Shader
6. **Shader Output** → Final rendered frame on WebGPU canvas

## Key Interactions

- **App ↔ StreetView**: App receives panorama instance and canvas from StreetView
- **App ↔ WebGPUCanvas**: App passes source canvas and rendering parameters
- **App ↔ InputHandler**: InputHandler sends navigation/interaction events to App
- **App ↔ MiniMap**: MiniMap displays current panorama position and heading
- **Renderer ↔ Shaders**: Renderer orchestrates compute shader execution each frame

## Rendering Modes

- **streetview**: Direct pass-through rendering of Street View panorama
- **liquid-v3**: Fluid simulation with velocity and advection shaders (currently primary mode)

## Future Agent Considerations

As outlined in `plan.md`, future agents/systems may include:
- Snapshot Gallery Manager
- Time Travel/Historical Imagery Controller
- POI (Point of Interest) Overlay System
- Measurement Tools Agent
- Tour Creator/Player
- Offline Cache Manager
- Analytics/Statistics Tracker

---

*Last Updated: 2025-12-09*
