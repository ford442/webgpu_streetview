/**
 * CPU half of the portal's road-look mirror.
 *
 * `weather-post` computes `applyTemperatureTint`'s per-channel multiplier in the
 * fragment shader (`kelvinToRGB` — two `log`s and two `pow`s per pixel). The
 * multiplier is a function of two uniforms, so the portal evaluates it once here
 * per change and uploads a `vec3`, instead of paying for it inside every lens
 * pixel.
 *
 * This is a literal port of `public/shaders/weather-post/01-foundation.wgsl`'s
 * `kelvinToRGB` / `applyTemperatureTint`; `windshieldPortal.parity.test.ts`
 * reads the WGSL and fails if any coefficient here drifts from it.
 */

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function kelvinToRGB(kelvin: number): [number, number, number] {
    let r = 255;
    let g = 255;
    let b = 255;
    const temp = clamp(kelvin, 1000, 40000) / 100;

    if (temp > 66) {
        r = clamp(329.698727446 * Math.pow(temp - 60, -0.1332047592), 0, 255);
    }

    if (temp <= 66) {
        g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    } else {
        g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    }
    g = clamp(g, 0, 255);

    if (temp < 66) {
        if (temp > 19) {
            b = clamp(138.5177312231 * Math.log(temp - 10) - 305.0447927307, 0, 255);
        } else {
            b = 0;
        }
    }

    return [r / 255, g / 255, b / 255];
}

/** `applyTemperatureTint`'s multiplier for packed (shader-space) temperature and tint. */
export function computeTempMult(
    temperature: number,
    tint: number,
): [number, number, number] {
    const kelvin = kelvinToRGB(6500 + temperature * 5000);
    const neutral = kelvinToRGB(6500);
    return [
        (kelvin[0] / neutral[0]) * (1 + tint * 0.05),
        (kelvin[1] / neutral[1]) * (1 + tint * 0.1),
        (kelvin[2] / neutral[2]) * (1 + tint * 0.05),
    ];
}
