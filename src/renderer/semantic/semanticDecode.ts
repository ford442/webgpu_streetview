/**
 * The semantic model's output → the `rg8unorm` class map (#352). Runs in the
 * depth Worker on the model's `[1, C, H, W]` class probabilities (softmax,
 * grouping and the upsample already happened on the GPU, in the model's
 * appended head), so this is one argmax over a handful of planes — model I/O,
 * like `rgbaToImageNetNchw`, not batch numeric work for the WASM layer.
 *
 * Output texel `i`: `[id + 1, round(p · 255)]` (`semanticClasses.ts`), plus
 * the fraction of texels per class for the probe's histogram and — given the
 * model's input frame — the photo's mean sky colour, which the sky replacement
 * regrades against and keys on.
 */
export interface DecodedSemanticMap {
    /** `width × height × 2` bytes: class id + 1, probability. */
    texels: Uint8Array<ArrayBuffer>;
    /** Fraction of texels labelled each class; sums to 1. */
    histogram: Float32Array<ArrayBuffer>;
    /** Mean winning probability. */
    meanConfidence: number;
    /**
     * Mean RGB (0–1, the frame's own encoding) of the input pixels labelled
     * sky; `[0, 0, 0]` without an input frame or without sky.
     */
    skyColor: [number, number, number];
}

export function decodeSemanticProbs(
    probs: ArrayLike<number>,
    classes: number,
    width: number,
    height: number,
    /** The model's input frame (`width × height` RGBA), for `skyColor`. */
    rgba?: ArrayLike<number>,
): DecodedSemanticMap {
    const plane = width * height;
    if (classes < 1 || classes > 254 || plane <= 0 || probs.length < classes * plane) {
        throw new Error(`semantic output is ${probs.length} values, expected ${classes} × ${width} × ${height}`);
    }
    const texels = new Uint8Array(plane * 2);
    const counts = new Float64Array(classes);
    let confidenceSum = 0;
    const withFrame = rgba !== undefined && rgba.length >= plane * 4;
    let skyR = 0, skyG = 0, skyB = 0;
    for (let i = 0; i < plane; i++) {
        let best = 0;
        let bestP = probs[i]!;
        for (let c = 1; c < classes; c++) {
            const v = probs[c * plane + i]!;
            if (v > bestP) {
                bestP = v;
                best = c;
            }
        }
        // NaN (a broken run) loses every comparison: class 0 at probability 0.
        const p = bestP > 0 ? Math.min(bestP, 1) : 0;
        texels[i * 2] = best + 1;
        texels[i * 2 + 1] = Math.round(p * 255);
        counts[best]! += 1;
        confidenceSum += p;
        if (best === 0 && withFrame) {
            skyR += rgba[i * 4]!;
            skyG += rgba[i * 4 + 1]!;
            skyB += rgba[i * 4 + 2]!;
        }
    }
    const histogram = new Float32Array(classes);
    for (let c = 0; c < classes; c++) histogram[c] = counts[c]! / plane;
    const skyN = withFrame ? counts[0]! * 255 : 0;
    const skyColor: [number, number, number] = skyN > 0 ? [skyR / skyN, skyG / skyN, skyB / skyN] : [0, 0, 0];
    return { texels, histogram, meanConfidence: confidenceSum / plane, skyColor };
}
