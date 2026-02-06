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
* **Input**: Reads the