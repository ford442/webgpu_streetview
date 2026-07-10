# Weekly Plan

## Issues to Fix

### 1. Snow Shader - Snowflakes Falling Upside Down
- **Problem**: Snowflakes are falling upside down, moving toward the top of the screen instead of the bottom
- **Priority**: High
- **Notes**: Likely a sign issue in the velocity/gravity calculation within the snow shader

### 2. Night Shader / Rendering Too Dark
- **Problem**: Night shader or another setting has caused everything to render totally dark
- **Priority**: High
- **Notes**: Investigate night shader uniforms, ambient light levels, or tone mapping settings

### 3. Car Chassis Movement During Free-Look in Cabin
- **Problem**: When free-looking around the cabin and out the windows, the car chassis still moves in ways that fight head look
- **Priority**: High
- **Notes**: Want free-look around the cabin without chassis coupling; head should pan independently while the body stays put unless actively steering

### 4. Windshield Wipers Fail to Switch On
- **Problem**: Windshield wipers do not turn on when toggled
- **Priority**: High
- **Notes**: Check DashboardUI / car API wiring (`setCarWipers`), CarInterior wiper animation, and control mode guards that may block the toggle

### 5. Rearview Mirror Does Not Show Behind
- **Problem**: Rearview mirror does not yet show the view behind the car
- **Priority**: High
- **Notes**: `RearviewMirror.ts` should render a ~180° behind view from the Street View canvas; verify sampling, UV/heading offset, and texture binding

### 6. Cruise Mode Transition Feel (Pause, No Zoom Animation)
- **Problem**: Cruise mode uses a zoom-style animation; prefer no animation and a hold/pause instead of Google Maps’ blurry zoom
- **Priority**: Medium
- **Notes**: Prefer hold-pause frozen frame (no zoom-blur / zoom-chromatic) over built-in Maps blurry zoom; align cruise hops with hold-pause release, not legacy zoom transitions

### 7. Speedometer Obscures Dashboard — Affix Readout to Dash
- **Problem**: Speedometer readout overlays and obscures the dashboard
- **Priority**: Medium
- **Notes**: Move / affix the speedometer (and related gauges) to the physical dash so it reads as part of the interior instead of floating over UI

### 8. Shader Modes Design Pass (Rain, Night, Sunset, etc.)
- **Problem**: Weather / time-of-day shader modes (rain, night, sunset, etc.) could use more design work
- **Priority**: Medium
- **Notes**: Polish look and feel of rain, night, sunset/sunrise, fog, and related atmosphere presets — tuning uniforms, color grading, and visual cohesion across modes

