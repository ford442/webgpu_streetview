import * as THREE from 'three';

export interface VanityMirrorUniforms {
  tDiffuse: { value: THREE.Texture | null };
  warmth: { value: number };
}

export function createVanityMirrorGlslMaterial(
  map: THREE.Texture,
  warmth = 0.18,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: map },
      warmth: { value: warmth },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float warmth;
      varying vec2 vUv;
      void main() {
        vec2 uv = vec2(1.0 - vUv.x, vUv.y);
        vec3 color = texture2D(tDiffuse, uv).rgb;
        color = mix(color, color * vec3(1.05, 0.98, 0.92), warmth);
        float edge = smoothstep(0.45, 0.2, distance(vUv, vec2(0.5)));
        color *= mix(0.75, 1.0, edge);
        gl_FragColor = vec4(color, 0.92);
      }
    `,
    transparent: true,
  });
}
