import * as THREE from 'three';

export interface RearviewMirrorUniforms {
  nightMode: { value: number };
  rearAvailable: { value: number };
  time: { value: number };
  rearTex: { value: THREE.Texture | null };
  rearPan: { value: number };
  rearFade: { value: number };
}

export function createRearviewMirrorGlslMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      nightMode: { value: 0.0 },
      rearAvailable: { value: 0.0 },
      time: { value: 0.0 },
      rearTex: { value: null },
      rearPan: { value: 0.0 },
      rearFade: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float nightMode;
      uniform float rearAvailable;
      uniform float time;
      uniform sampler2D rearTex;
      uniform float rearPan;
      uniform float rearFade;
      varying vec2 vUv;

      void main() {
        vec3 glass = vec3(0.06, 0.07, 0.09);
        if (nightMode > 0.5) {
          glass = vec3(0.03, 0.06, 0.04);
        }

        float dist = distance(vUv, vec2(0.5));
        float vignette = 1.0 - smoothstep(0.25, 0.72, dist);
        glass *= mix(0.55, 1.0, vignette);

        float frost = 0.02 + 0.015 * sin(vUv.y * 40.0 + time * 0.4);
        glass += vec3(frost);

        float band = smoothstep(0.42, 0.48, vUv.y) * (1.0 - smoothstep(0.52, 0.58, vUv.y));
        float bandX = smoothstep(0.18, 0.28, vUv.x) * (1.0 - smoothstep(0.72, 0.82, vUv.x));
        float label = band * bandX;
        vec3 labelColor = nightMode > 0.5
          ? vec3(0.15, 0.45, 0.18)
          : vec3(0.35, 0.38, 0.42);
        glass = mix(glass, labelColor, label * 0.85);

        if (rearAvailable > 0.5) {
          vec2 rearUv = vec2(1.0 - vUv.x + rearPan, vUv.y);
          vec2 inside = step(vec2(0.0), rearUv) * step(rearUv, vec2(1.0));
          float coverage = inside.x * inside.y;
          vec3 rear = texture2D(rearTex, clamp(rearUv, 0.0, 1.0)).rgb;
          rear *= mix(0.92, 0.42, nightMode);
          rear *= mix(0.6, 1.0, vignette);
          glass = mix(glass, rear, clamp(rearFade, 0.0, 1.0) * coverage);
        }

        gl_FragColor = vec4(glass, 1.0);
      }
    `,
  });
}
