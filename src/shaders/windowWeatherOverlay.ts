import * as THREE from 'three';

/** Screen-space rain streaks + condensation mist on the windshield plane. */
export const windowWeatherOverlayVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const windowWeatherOverlayFragment = /* glsl */ `
precision highp float;

uniform float time;
uniform float rainIntensity;
uniform float condensation;
uniform float wiperPhase;
uniform bool wiperActive;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float streak(vec2 uv, float seed) {
  float fall = fract(time * (0.25 + hash(vec2(seed)) * 0.2) + seed);
  vec2 p = vec2(hash(vec2(seed, 1.0)), 1.0 - fall);
  float dx = abs(uv.x - p.x);
  float dy = uv.y - p.y;
  float body = smoothstep(0.004, 0.0, dx) * smoothstep(0.06, 0.0, dy) * smoothstep(-0.01, 0.0, dy - 0.055);
  float head = smoothstep(0.008, 0.0, length(uv - p));
  return max(body, head);
}

float wiperClear(vec2 uv) {
  if (!wiperActive) return 0.0;
  float sweep = sin(wiperPhase * 6.28318);
  vec2 pivot = vec2(0.25, 0.02);
  vec2 dir = uv - pivot;
  float ang = atan(dir.x, dir.y) - sweep * 1.1;
  float arc = smoothstep(0.18, 0.0, abs(ang)) * smoothstep(0.08, 0.55, length(dir));
  vec2 pivot2 = vec2(0.75, 0.02);
  vec2 dir2 = uv - pivot2;
  float ang2 = atan(dir2.x, dir2.y) + sweep * 1.1;
  float arc2 = smoothstep(0.18, 0.0, abs(ang2)) * smoothstep(0.08, 0.55, length(dir2));
  return max(arc, arc2);
}

void main() {
  float rain = 0.0;
  float maxStreaks = 18.0 * rainIntensity;
  for (float i = 0.0; i < 18.0; i++) {
    if (i >= maxStreaks) break;
    rain += streak(vUv, i + 1.0);
  }
  rain = clamp(rain, 0.0, 1.0);

  float mist = condensation * (
    0.35 +
    0.25 * sin(vUv.x * 40.0 + time * 0.15) * sin(vUv.y * 28.0 - time * 0.1)
  );
  mist *= smoothstep(0.15, 0.85, vUv.y) * smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);

  float clear = wiperClear(vUv);
  rain *= 1.0 - clear * 0.92;
  mist *= 1.0 - clear * 0.75;

  float alpha = clamp(rain * 0.55 + mist * 0.35, 0.0, 0.75);
  vec3 color = mix(vec3(0.75, 0.88, 1.0), vec3(0.92, 0.95, 1.0), mist);
  gl_FragColor = vec4(color, alpha);
}
`;

export interface WindowWeatherOverlayUniforms {
  time: { value: number };
  rainIntensity: { value: number };
  condensation: { value: number };
  wiperPhase: { value: number };
  wiperActive: { value: boolean };
}

export function createWindowWeatherOverlayUniforms(): WindowWeatherOverlayUniforms {
  return {
    time: { value: 0 },
    rainIntensity: { value: 0 },
    condensation: { value: 0 },
    wiperPhase: { value: 0 },
    wiperActive: { value: false },
  };
}

export function createWindowWeatherOverlayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: createWindowWeatherOverlayUniforms() as unknown as { [uniform: string]: THREE.IUniform },
    vertexShader: windowWeatherOverlayVertex,
    fragmentShader: windowWeatherOverlayFragment,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}
