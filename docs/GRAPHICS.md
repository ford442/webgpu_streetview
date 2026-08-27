# Graphics — Weather & Atmosphere Look Targets

Reference for the WebGPU weather post-process stack: what each preset is
*supposed* to look like, which knob controls it, and how the three render paths
are kept in agreement.

Related: `docs/RENDERER_FALLBACK.md` (backend selection), `AGENTS.md`
("Shader Uniform Layouts"), `src/renderer/weatherUniformLayout.ts` (the 40-float
contract).

---

## 1. The three paths

| Path | Entry point | Notes |
|------|-------------|-------|
| Fragment (default) | `public/shaders/weather-post.wgsl` | HDR `rgba16float`, full effect set |
| Compute (`?weather=compute`) | `public/shaders/weather-post-compute.wgsl` | `rgba32float` storage texture + blit; adds the depth-proxy storage target |
| GLSL reference (not live) | `src/renderer/webgl/weatherReference.glsl.ts` | SDR approximation for must-match tests; **not constructed** at runtime |

All three read the same 40-float uniform block. Shared WGSL helpers are held
byte-identical between the two WGSL paths and guarded by
`src/renderer/weatherShaderParity.test.ts` — if you edit one, edit both.

---

## 2. Cohesion model

Atmospheric channels are no longer independent sliders. `src/renderer/weatherCohesion.ts`
derives them together on the CPU (cheap, testable, identical for every backend)
from four rules:

1. **Precipitation implies cloud cover.** `overcast = 0.85·precip + 0.45·fog`,
   and overcast multiplies down `lightShaftsIntensity`, `lensFlareIntensity`
   and `anamorphicStreak`.
2. **Rain wets the air.** `humidityHaze` follows rain (and, weakly, snow/fog);
   precipitation adds its own low ground mist to `fogDensity` even with the fog
   slider at zero.
3. **Rain scrubs dust.** `dustIntensity` scales with `(1 − rain)`; snow only
   halves it.
4. **Fog is two different quantities.** `fogDensity` is a Beer–Lambert
   extinction coefficient integrated along the view-depth proxy; `fogIntensity`
   is a flat screen-wide aerial wash. They used to carry the *same* slider
   value into both slots, which double-counted inside the shader.

### View-depth proxy

Street View gives us no depth buffer, so `viewDepthProxy()` reconstructs a
usable one from screen Y and camera pitch:

- `viewHorizonY(cameraPitch)` — where the horizon sits on screen (0.5 = level,
  ~90° vertical FOV ⇒ one pitch unit ≈ two screens).
- Above that line ⇒ depth `1.0` (sky / skyline, effectively at infinity).
- Below it ⇒ `0.06 / (uv.y − horizonY)`, a hyperbolic falloff standing in for
  `eyeHeight / tan(angleBelowHorizon)`.

This one function now feeds height fog, precipitation attenuation and the DOF
circle of confusion, so those three effects agree about where the ground is.
In the compute path the value is also written to the `r32float` storage texture
at binding 6 every dispatch.

---

## 3. Preset look targets

Slider values are the UI 0–100 range from `WeatherPanel.tsx`.

### ☀️ Clear (rain 0 / snow 0 / fog 0)
Untouched panorama plus grading. Sun FX at full strength: shafts sit at their
0.35 floor (nothing in the air to scatter in), flare 0.4, anamorphic 0.5.
No fog, no haze; dust visible only when the WASM tile is feeding.

### 🌧️ Rain (rain 60, wind 30)
Cool blue-grey overcast. Direct-sun FX drop by about half (overcast 0.51).
Streaks slant with wind, lens droplets refract the scene, humidity haze
softens the far field, and a shallow ground mist appears at the horizon line.
Scene darkening −26% by day, easing to −12% at night so the readable-night
floor from #171 survives. Dust drops to ~40% of its clear-day level.

On the **compute** path (Ultra, or `?weather=compute` at High) a second layer
of WASM-seeded GPU particles is splatted into bindings 7/8: streaks pick up
the same wind, fall downward (`WEATHER_FALL_Y_SIGN = −1`), thicken toward the
windshield, and light up in the headlight cone at night. The fragment default
and the GLSL reference stay on the procedural `rain()` function only.

### ⛈️ Storm (rain 100, wind 80)
As above, pushed to a near-black sky: overcast 0.85 ⇒ lens flare 0.4 → 0.06.
Ground mist reaches `fogDensity` 0.28 with the fog slider still at zero.

### ❄️ Snow / 🌨️ Blizzard (snow 70–100)
Flakes stay bright and gain a further +35% when headlights are on at night —
they should read as *lit by the car*, not self-luminous. Snow suppresses dust
only halfway and adds far less humidity haze than rain (cold air holds less
water). Overcast is slightly weaker than the equivalent rain value.

Compute-path GPU particles add depth-aware flakes on top of that procedural
base (occluded by the view-depth proxy, denser near the windshield, extra
headlight bloom). `prefers-reduced-motion` quarters the particle count rather
than turning the layer off. `?wasmParticles=off` disables the GPU field for
A/B against procedural-only compute rain/snow. Low/Medium quality never
allocate the storage textures.

### 🌫️ Fog (fog slider)
Thin fog (≤20) lifts into an elevated haze band that leaves the road clear;
heavy fog (≥60) settles into a low bank hugging the ground and reaching full
extinction at the horizon. At night the palette switches from neutral grey to
the blue index, and any indexed colour is blended toward the night fog colour
so a coloured fog can't stay bright in the dark.

### 🌅 Sunrise / 🌇 Sunset
Both are now camera-aware. Warm light concentrates around the sun's *actual*
screen azimuth and the tracked horizon line; the cool shadow tint fills the
opposite half of the sky.

---

## 4. Before / after notes

Measured from the shader math (this container has no GPU; these are the
analytic coverage values the code produces, not screenshots).

**Fog, slider at 40, level camera.** Old code keyed everything off
`smoothstep(0.35, 0, |uv.y − 0.5|)`, i.e. a horizontal stripe pinned to the
middle of the screen regardless of where the camera was pointing:

| Pixel | Old coverage | New coverage |
|-------|--------------|--------------|
| Near ground (`uv.y` 0.9) | 0.06 | 0.38 |
| Horizon (`uv.y` 0.51) | 0.60 | 0.88 |
| Sky (`uv.y` 0.2) | 0.06 | 0.54 |

Before: a band across the middle of the frame that stayed put when you pitched
the camera, with the road in front of you *clearer* than the mid-distance.
After: coverage grows monotonically with distance, tracks the horizon as you
look up and down, and thins overhead — aerial perspective instead of a stripe.

**Fog double-count.** `fogIntensity` and `fogDensity` both received
`slider/100`. At slider 100 their sum reached `0.2 + 1.8·groundProximity`
before the `×(0.75 + roll)` rolling factor, saturating the 0.95 clamp wherever
`groundProximity > 0.6` — so the top half of the fog slider did nothing
visible. They are now 0.55× and 1.15× the slider respectively, feeding
different terms.

**Precipitation vs. fog.** Rain streaks and snowflakes previously composited at
full brightness *over* the fog wash, so a blizzard in dense fog showed crisp
flakes on a flat grey wall. They now fade with `precipVisibility = 1 − 0.75·fogMask`.

**Precipitation vs. sun.** A downpour used to sit under a lens-flared,
light-shafted sky. Overcast now suppresses all three sun FX together.

**Sunrise.** `applySunrise` was pinned to `uv.y 0.5` and ignored heading
entirely — dawn light stayed glued to the same screen region while you turned,
and disagreed with `sunsetHorizonGlow`, which was already camera-aware. Both
now use `worldAzimuthToScreenX` and `viewHorizonY`.

**Night rain.** Rain multiplied the scene by `1 − 0.22·rain` regardless of time
of day, which crushed the #171 readable-night floor during a night storm.
The factor now interpolates to `0.10` at full night, and streaks pick up
headlight warmth.

**Compute-path dust.** The compute variant had no access to the WASM noise tile,
so its dust was uniform speckle while the fragment path showed drifting
clumps — the two paths visibly disagreed under `?weather=compute`. The tile is
now bound and both sample it identically.

**Compute path did not compile at all.** `weather-post-compute.wgsl` called
`applyVolumetricLightShafts` with four arguments against a three-parameter
declaration, so Tint rejected the whole module and `?weather=compute` (and the
Ultra preset default) never produced a frame from the compute pipeline. WGSL is
only compiled when a real GPU device exists, so no GPU-less CI run could catch
it. Fixed by matching the fragment path's signature, and
`src/renderer/weatherShaderCallArity.test.ts` now checks every local call's
argument count statically. Validate locally with
[`naga`](https://github.com/gfx-rs/wgpu/tree/trunk/naga):

```bash
cargo install naga-cli
naga --validate 31 public/shaders/weather-post.wgsl
naga --validate 31 public/shaders/weather-post-compute.wgsl
naga --validate 31 public/shaders/weather-particles.wgsl
```

---

## 5. Compute-path storage surfaces

`ComputeWeatherPostProcessor` follows the `image_video_effects` 13-binding
header. Status of each reserved surface:

| Binding | Resource | Status |
|---------|----------|--------|
| 6 `writeDepthTexture` | full-res `r32float` | **real** — view-depth proxy, written every dispatch |
| 12 `plasmaBuffer` | 64×64 WASM noise tile as 1024 `vec4`s | **real** — drives dust turbulence (fBm detail, see below) |
| 4 `readDepthTexture` | full-res `r32float` | **real** — previous-frame depth ping-pong |
| 7 `dataTextureA` | half-res `rgba32float` | **real** when GPU particles are on — density splat (readable) |
| 8 `dataTextureB` | compact `rgba32float` grid | **real** when GPU particles are on — particle-state write target |
| 9 `dataTextureC` | 1×1 `rgba8unorm` | dummy |

GPU precipitation (`public/shaders/weather-particles.wgsl`) is gated to the
compute weather path at High/Ultra. `WasmParticleFeeder` calls
`fill_particle_seeds` once (and again on count change or a dry→wet restart);
a compute integrate pass advects with wind + gravity (`WEATHER_FALL_Y_SIGN`)
and a splat pass writes density. The fragment path stays
procedural. See `docs/WASM_BRIDGE.md`.

### Noise tile detail differs by path

Both paths read the same 64×64 CPU tile through the same bilinear sampler
(`weatherShaderParity.test.ts` enforces the filtering math across the `vec4`
packing), but they are fed different tiles:

| Path | Tile source | Why |
|---|---|---|
| fragment (default) | `fill_noise_buffer` — one Perlin octave | keeps the default look byte-identical |
| compute (`?weather=compute`, Ultra preset) | `fill_fbm_buffer` — 4 octaves, lacunarity 2.0, gain 0.5 | dust clumps gain structure at several scales |

`WebGPUCanvas` picks the mode from `renderer.getWeatherPostProcessMode()` and
calls `WasmNoiseFeeder.setDetail()`; the tile still refreshes every 30 frames in
both cases. `?wasmNoise=off` disables the upload entirely and the shader reverts
to uniform dust density.

---

## 6. Cinematic camera FX

Depth of field and motion blur live behind `src/renderer/cinematicCameraFx.ts`
and occupy uniform slots 38/39. They turn on only when **both** hold:

- the active quality preset enables them — High = DOF, Ultra = DOF + motion blur
  (`getActiveQualityLevel()`, overridable with `?quality=high|ultra`)
- the user has not asked for reduced motion (`prefers-reduced-motion: reduce`)

Motion blur additionally scales with travel speed published by
`src/renderer/cameraMotionSignal.ts` (car telemetry, decaying to zero ~400 ms
after the publisher stops), so a parked car gets none of it and it ramps in over
the first ~40% of the speed range.

Both effects share one 6-tap loop and early-out when both strengths are zero,
so the default fragment path pays a single branch. DOF focuses at depth 0.45
and defocuses toward infinity; motion blur streaks radially away from screen
centre and is biased toward the frame edges.

The GLSL reference does not implement either — it ignores slots 38/39.

---

## 8. Artistic looks (scene packs)

Named looks live in `src/config/lookPacks.ts` and apply **weather + grading +
time-of-day + vehicle lights** in one click. They are piecewise curves over the
existing 6 grading uniforms (vibrance → saturation → contrast → temperature/tint
→ exposure) with **ACES still last**. No 3D LUT texture, no extra uniform slots,
no billable APIs.

The look bible (before/after notes, curve stops, palette cards) is
[`docs/looks/README.md`](./looks/README.md).

| Id | Intent |
|----|--------|
| `clear` | Reset — daylight, no weather, neutral grade |
| `noir` | Ink-black night, wet streets, headlights |
| `teal-orange` | Travel-poster split tone at sunset |
| `bleach-bypass` | Silver-retention newsreel, overcast sun kill |
| `golden-hour` | Honey sunrise, soft haze |
| `storm` | GRAPHICS.md §3 storm sliders + cool underexpose |
| `arctic` | High-key snow, cold air |
| `neon-rain` | Wet night, magenta/cyan, high beam |

Share with location deep links:

```text
?look=noir
?look=noir&rain=40
?tod=night&sat=0.4&con=1.55
```

`src/utils/lookLink.ts` round-trips `look` + overrides. Reduced motion still
applies the grade/weather; it only zeroes cinematic slots 38/39.

Creator UX: **Looks** toolbar button (shortcut `K`) or the Looks strip inside
the Weather panel. **Copy look as URL** writes the current pack + diffs.

---

## 9. GLSL reference parity budget

The GLSL reference (`src/renderer/webgl/weatherReference.glsl.ts`) is SDR and skips DOF, motion blur, fBm dust, and the 4-tap
haze blur. Isolation flags (`?effect=weather|night|fog`) exist on WebGPU so look targets
can be compared directionally.

| Effect | Must match | Best effort | Skip |
|--------|------------|-------------|------|
| Night floor (`NIGHT_BASE_FLOOR`) | ✓ | | |
| Precip fall Y sign (`WEATHER_FALL_Y_SIGN = −1`) | ✓ | | |
| Overcast sun kill (CPU `weatherCohesion`) | ✓ | | |
| Rain darken `mix(0.22, 0.10, night)` | ✓ | | |
| Humidity haze distance + color mix | ✓ | | |
| Humidity haze 4-tap blur | | | ✓ (WebGPU) |
| fBm / WASM dust | | | ✓ (WebGPU) |
| DOF / motion blur (slots 38/39) | | | ✓ (WebGPU High/Ultra) |
| GPU particles (`?weather=compute`) | | | ✓ (compute only) |
| Fog coverage along view-depth proxy | | ✓ SDR approx | |
| Color grade + ACES-style tonemap | | ✓ Reinhard SDR | |

Guarded by `src/renderer/webglLookParity.test.ts` and
`src/renderer/weatherCohesion.test.ts`.

---

## 10. Editing checklist

- Shared WGSL helper changed? Update **both** `weather-post.wgsl` and
  `weather-post-compute.wgsl`; `weatherShaderParity.test.ts` will fail otherwise.
- New uniform? It must fit the existing 40 floats or every consumer in
  `weatherUniformLayout.ts`'s header comment changes in lockstep.
- Preset retune? Put the intended look in §3 above and the measured delta in §4.
  Named artistic looks go in `src/config/lookPacks.ts` + `docs/looks/README.md`.
- Coupling between channels belongs in `weatherCohesion.ts` (CPU, testable),
  not duplicated into three shaders.
- Changing what the CPU noise tile contains? The fragment path is the default
  look — put new detail behind the compute path unless the change is intended to
  be visible everywhere. See `docs/WASM_BRIDGE.md` §3.
