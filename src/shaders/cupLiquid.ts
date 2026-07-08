import * as THREE from 'three';

export const cupLiquidVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const cupLiquidFragment = /* glsl */ `
precision highp float;

uniform float time;
uniform vec3 liquidColor;
uniform float fillLevel;
uniform float slosh;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  float wave = sin(vUv.x * 18.0 + time * 1.4) * 0.012 + sin(vUv.y * 14.0 - time * 0.9) * 0.01;
  float tilt = slosh * sin(vUv.x * 3.14159) * 0.04;
  float surface = fillLevel + wave + tilt;
  if (vUv.y > surface) discard;

  float depth = surface - vUv.y;
  vec3 col = mix(liquidColor * 0.7, liquidColor, clamp(depth * 8.0, 0.0, 1.0));
  float spec = pow(max(0.0, 1.0 - abs(vUv.y - surface) * 40.0), 3.0) * 0.35;
  gl_FragColor = vec4(col + spec, 0.88);
}
`;

export function createCupLiquidMaterial(color: THREE.ColorRepresentation = 0x3a2010): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      liquidColor: { value: new THREE.Color(color) },
      fillLevel: { value: 0.62 },
      slosh: { value: 0 },
    },
    vertexShader: cupLiquidVertex,
    fragmentShader: cupLiquidFragment,
    transparent: true,
    side: THREE.DoubleSide,
  });
}
