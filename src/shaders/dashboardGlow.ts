import * as THREE from 'three';

export const dashboardGlowVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const dashboardGlowFragmentShader = /* glsl */ `
precision highp float;

uniform float time;
uniform float intensity;
uniform vec3 glowColor;
uniform float pulseSpeed;
uniform float pulseAmount;
uniform vec3 glowCenter;
uniform float glowRadius;
uniform float falloff;

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  // Distance from glow source
  float dist = length(vWorldPosition - glowCenter);

  // Volumetric falloff
  float glow = 1.0 - smoothstep(0.0, glowRadius, dist);
  glow = pow(glow, falloff);

  // Pulsating effect
  float pulse = 1.0 + pulseAmount * sin(time * pulseSpeed);
  glow *= pulse;

  // Apply intensity
  glow *= intensity;

  // Radial gradient from UV center for screen-space softness
  float uvDist = length(vUv - vec2(0.5));
  float vignette = 1.0 - smoothstep(0.0, 0.7, uvDist);
  glow *= vignette;

  vec3 color = glowColor * glow;

  // Additive blending output
  gl_FragColor = vec4(color, glow);
}
`;

export interface DashboardGlowUniforms {
  time: { value: number };
  intensity: { value: number };
  glowColor: { value: THREE.Color };
  pulseSpeed: { value: number };
  pulseAmount: { value: number };
  glowCenter: { value: THREE.Vector3 };
  glowRadius: { value: number };
  falloff: { value: number };
}

export function createDashboardGlowUniforms(): DashboardGlowUniforms {
  return {
    time: { value: 0.0 },
    intensity: { value: 1.0 },
    glowColor: { value: new THREE.Color(0.2, 0.8, 1.0) },
    pulseSpeed: { value: 2.0 },
    pulseAmount: { value: 0.15 },
    glowCenter: { value: new THREE.Vector3(0.0, -0.3, 0.5) },
    glowRadius: { value: 1.5 },
    falloff: { value: 2.0 },
  };
}
