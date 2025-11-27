# WebGPU Fluid Simulation Agents

This project simulates interactive, fluid-like behavior on an image using WebGPU. The simulation is managed by three primary agents: a main renderer, a velocity shader, and an advection shader.

## 1. The Renderer (`src/renderer/Renderer.ts`)

This is the main orchestrator, written in TypeScript.

* **Role**: Manages all WebGPU resources, including textures, buffers, and pipelines.
* **Interaction**: It runs a multi-pass rendering loop on every frame.
* **Input**: Receives mouse coordinates (position, delta) and the current `RenderMode` from the React UI.
* **Output**: Renders the final image to the HTML canvas.
* **Key Logic**: For the "liquid-v3" mode, it manages a "ping-pong" texture system to update the simulation's state frame-by-frame.

## 2. The Velocity Shader (`public/shaders/velocity.wgsl`)

This is a compute shader that simulates the physics of the fluid's motion.

* **Role**: To calculate the velocity (direction and speed) of the liquid at every point.
* **Input**: Reads the velocity state from the previous frame and receives mouse data (position, delta) from a uniform buffer.
* **Output**: Writes the new, updated velocity field to a state texture.
* **Key Logic**: It applies friction to slow the liquid down and injects new velocity based on the user's mouse drag.

## 3. The Advection Shader (`public/shaders/advection.wgsl`)

This is a compute shader that moves the image's colors based on the fluid's motion.

* **Role**: To create the visual "smearing" or "stirring" effect.
* **Input**: Reads the final velocity field calculated by the velocity shader and the color state from the previous frame. It also has access to the original, undisturbed source image.
* **Output**: Writes the new, distorted color field to a state texture.
* **Key Logic**: For each pixel, it looks "upstream" (based on the velocity vector) to find what color should be pulled into that position. It also includes a small restoring force that gently pulls the colors back to their original positions over time.
