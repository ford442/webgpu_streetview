import * as THREE from 'three';

export const starfieldVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const starfieldFragmentShader = /* glsl */ `
precision highp float;

uniform float time;
uniform float density;
uniform float brightness;
uniform float twinkleSpeed;
uniform vec2 parallaxOffset;
uniform vec3 starColor;

varying vec2 vUv;

// Hash for pseudo-random star positions
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)),
           dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Voronoi-based star field
float starField(vec2 uv, float scale) {
  vec2 scaledUv = uv * scale;
  vec2 cell = floor(scaledUv);
  vec2 frac_uv = fract(scaledUv);

  float minDist = 1.0;
  float starBright = 0.0;

  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = hash2(cell + neighbor);

      // Threshold determines star density
      if (point.x > density) continue;

      vec2 diff = neighbor + point - frac_uv;
      float dist = length(diff);

      if (dist < minDist) {
        minDist = dist;
        // Per-star random phase for twinkling
        float phase = hash(cell + neighbor) * 6.28318;
        float twinkle = 0.5 + 0.5 * sin(time * twinkleSpeed * (0.5 + point.y) + phase);
        // Star intensity based on distance from center
        float starSize = 0.02 + 0.03 * point.y;
        float star = smoothstep(starSize, starSize * 0.1, dist);
        starBright = star * twinkle;
      }
    }
  }

  return starBright;
}

void main() {
  // Apply parallax offset for head movement
  vec2 uv = vUv + parallaxOffset * 0.02;

  // Multi-layer stars at different scales for depth
  float stars = 0.0;
  stars += starField(uv, 20.0) * 1.0;
  stars += starField(uv + vec2(0.37, 0.71), 35.0) * 0.6;
  stars += starField(uv + vec2(0.83, 0.19), 50.0) * 0.3;

  stars *= brightness;

  vec3 color = starColor * stars;

  gl_FragColor = vec4(color, stars);
}
`;

export interface StarfieldUniforms {
  time: { value: number };
  density: { value: number };
  brightness: { value: number };
  twinkleSpeed: { value: number };
  parallaxOffset: { value: THREE.Vector2 };
  starColor: { value: THREE.Color };
}

export function createStarfieldUniforms(): StarfieldUniforms {
  return {
    time: { value: 0.0 },
    density: { value: 0.3 },
    brightness: { value: 1.5 },
    twinkleSpeed: { value: 3.0 },
    parallaxOffset: { value: new THREE.Vector2(0.0, 0.0) },
    starColor: { value: new THREE.Color(1.0, 1.0, 0.95) },
  };
}
