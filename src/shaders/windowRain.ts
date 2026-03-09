import * as THREE from 'three';

export const windowRainVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const windowRainFragmentShader = /* glsl */ `
precision highp float;

uniform float time;
uniform float rainIntensity;
uniform float wiperAngle;
uniform bool wiperActive;
uniform vec2 resolution;
uniform sampler2D tDiffuse;

varying vec2 vUv;

// Hash functions for pseudo-random generation
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Smooth drop shape using smoothstep
float dropShape(vec2 uv, vec2 center, float radius) {
  float d = length(uv - center);
  return smoothstep(radius, radius * 0.3, d);
}

// Streak drop falling down glass
float streak(vec2 uv, vec2 origin, float seed) {
  float t = time * (0.4 + 0.3 * hash(vec2(seed)));
  float fallSpeed = 0.15 + 0.1 * hash(vec2(seed, 1.0));
  float yOffset = fract(t * fallSpeed + seed * 0.73);

  vec2 pos = origin;
  pos.y -= yOffset;
  // Slight horizontal wobble
  pos.x += sin(pos.y * 12.0 + seed * 6.28) * 0.003;

  float streakLen = 0.04 + 0.06 * hash(vec2(seed, 2.0));
  float dy = uv.y - pos.y;
  float dx = abs(uv.x - pos.x);

  float width = 0.002 + 0.001 * hash(vec2(seed, 3.0));
  float body = smoothstep(width, width * 0.2, dx) *
               smoothstep(0.0, 0.005, dy) *
               smoothstep(streakLen, 0.0, dy);

  // Head droplet
  float head = dropShape(uv, pos, 0.005 + 0.003 * hash(vec2(seed, 4.0)));

  return max(body, head) * rainIntensity;
}

// Static accumulated droplets on glass
float staticDroplet(vec2 uv, vec2 cell, float threshold) {
  vec2 rnd = hash22(cell);
  if (rnd.x > threshold) return 0.0;

  vec2 center = cell + rnd;
  float radius = 0.002 + 0.005 * rnd.y;
  float d = length(uv - center);
  return smoothstep(radius, radius * 0.2, d);
}

// Wiper clear zone
float wiperMask(vec2 uv) {
  if (!wiperActive) return 0.0;

  vec2 pivot = vec2(0.5, 0.0);
  vec2 dir = uv - pivot;
  float angle = atan(dir.x, dir.y);
  float dist = length(dir);

  float sweepAngle = wiperAngle * 3.14159 / 180.0;
  float sweep = sin(time * 2.0) * sweepAngle;

  float arcWidth = 0.15;
  float inArc = smoothstep(-arcWidth, 0.0, angle - sweep) *
                smoothstep(0.0, -arcWidth, angle - sweep - 0.5);
  float inRadius = smoothstep(0.2, 0.25, dist) * smoothstep(0.95, 0.9, dist);

  return inArc * inRadius;
}

void main() {
  vec2 uv = vUv;
  float aspect = resolution.x / resolution.y;

  float rainLayer = 0.0;
  vec2 distortion = vec2(0.0);

  // Falling streaks
  float streakCount = 30.0 * rainIntensity;
  for (float i = 0.0; i < 30.0; i++) {
    if (i >= streakCount) break;
    vec2 origin = vec2(hash(vec2(i, 0.0)), 1.0);
    float s = streak(uv, origin, i);
    rainLayer += s;
    // Refraction distortion from streaks
    vec2 toCenter = normalize(vec2(0.5) - uv);
    distortion += toCenter * s * 0.01;
  }

  // Static accumulated droplets
  float gridScale = 80.0;
  vec2 gridUv = uv * gridScale;
  vec2 cell = floor(gridUv);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 neighbor = cell + vec2(float(x), float(y));
      float drop = staticDroplet(gridUv, neighbor, 0.3 * rainIntensity);
      rainLayer += drop * 0.5;
      vec2 rnd = hash22(neighbor);
      vec2 dropCenter = neighbor + rnd;
      vec2 toDropCenter = normalize(dropCenter - gridUv);
      distortion += toDropCenter * drop * 0.003;
    }
  }

  // Apply wiper clear zone
  float wiper = wiperMask(uv);
  rainLayer *= (1.0 - wiper * 0.9);
  distortion *= (1.0 - wiper * 0.9);

  // Sample scene with distortion
  vec2 distortedUv = uv + distortion;
  distortedUv = clamp(distortedUv, 0.0, 1.0);
  vec4 scene = texture2D(tDiffuse, distortedUv);

  // Blend rain over scene: slight brightening where drops are
  float highlight = rainLayer * 0.15;
  vec3 color = scene.rgb + vec3(highlight);

  // Slight blur in rainy areas for wet-glass look
  vec3 blurred = vec3(0.0);
  float blurSize = rainLayer * 0.003;
  for (int bx = -1; bx <= 1; bx++) {
    for (int by = -1; by <= 1; by++) {
      vec2 offset = vec2(float(bx), float(by)) * blurSize;
      blurred += texture2D(tDiffuse, distortedUv + offset).rgb;
    }
  }
  blurred /= 9.0;
  color = mix(color, blurred, clamp(rainLayer, 0.0, 1.0));

  gl_FragColor = vec4(color, scene.a);
}
`;

export interface WindowRainUniforms {
  time: { value: number };
  rainIntensity: { value: number };
  wiperAngle: { value: number };
  wiperActive: { value: boolean };
  resolution: { value: THREE.Vector2 };
  tDiffuse: { value: THREE.Texture | null };
}

export function createWindowRainUniforms(): WindowRainUniforms {
  return {
    time: { value: 0.0 },
    rainIntensity: { value: 0.5 },
    wiperAngle: { value: 45.0 },
    wiperActive: { value: false },
    resolution: { value: new THREE.Vector2(1920, 1080) },
    tDiffuse: { value: null },
  };
}
