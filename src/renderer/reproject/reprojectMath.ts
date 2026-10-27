/**
 * The road frame's last stage before present (#331): re-aim it at the view the
 * user has *now* (late latch) and, for stereo, synthesise each eye from depth.
 *
 * Pure maths only — the GPU half is `reproject.wgsl` + `ReprojectPass.ts`. The
 * CPU reference here mirrors the shader line for line so tests can pin
 * direction, the delta-0 copy and the disocclusion fill without a GPU.
 *
 * ### Late latch
 *
 * The road frame is packed with the POV `WebGPUCanvas` read at the top of its
 * `requestAnimationFrame`. In car mode the car loop runs *after* it in the
 * same frame and derives this frame's POV (`cabinPovSync`), then renders the
 * cabin with it — so the road was one frame behind the cabin it sits under.
 * The tail of the frame (`frameTail.ts`) runs after the car loop and reads the
 * POV again; this module turns the difference into a rotation of the finished
 * frame. A rotation about the eye has no parallax, so the latch needs no
 * depth: it is an exact rectilinear re-projection (a homography), not the
 * small-angle UV shift of the hold-pause look-around.
 *
 * ### Stereo
 *
 * An eye is the camera moved sideways by half the IPD. In the eye's image a
 * point at depth Z moves by `(ipd / 2) · (1/Z − 1/Zc) / (2 tan(hfov/2))` of
 * the width (Zc: the convergence distance, which lands at zero parallax). The
 * eye is *gathered*: each output pixel searches the centre image along its row
 * for the surface whose own shift brings it here (`stereoSourceX`), nearest
 * first. Where no surface is consistent — a disocclusion, background the
 * centre view never saw — it takes the farthest surface the search touched,
 * nearest to the edge (nearest-far-neighbour), so a hole is filled with
 * background instead of a smear of the foreground. A gather never leaves an
 * unwritten pixel.
 */

const DEG = Math.PI / 180;

/** Normalised scene depth 1 (the horizon, `viewDepthProxy`'s scale) in metres. */
export const DEPTH_FAR_METRES = 27;
/** The nearest surface the stereo search considers — under the car's nose. */
export const DEPTH_NEAR_METRES = 1.2;
/** Average adult IPD; the acceptance figure for the disocclusion fill. */
export const DEFAULT_IPD_METRES = 0.064;
/**
 * Zero-parallax distance on a flat display: about the windshield, so the mono
 * cabin (which sits at the screen plane) never floats behind the road.
 */
export const DEFAULT_CONVERGENCE_METRES = 1.0;
/** Stereo search taps along the row. */
export const STEREO_SEARCH_STEPS = 24;

export type ReprojectMode = 'copy' | 'latch' | 'sbs' | 'anaglyph' | 'eye';

export const REPROJECT_MODE_CODE: Record<ReprojectMode, number> = {
    copy: 0,
    latch: 1,
    sbs: 2,
    anaglyph: 3,
    /** One eye into its own target (a WebXR sub-image). */
    eye: 4,
};

/** `ReprojectUniforms` in `reproject.wgsl`: 28 floats, 112 bytes. */
export const REPROJECT_UNIFORM_FLOAT_COUNT = 28;

export const ReprojectUniformIndex = {
    mode: 0,
    /** tan(hfov / 2) of the *packed* frame (one eye image of it). */
    tanHalfH: 1,
    tanHalfV: 2,
    /** Half the IPD in metres; 0 = mono. */
    halfIpd: 3,
    /** 1 / convergence distance (1/m). */
    convergenceInv: 4,
    depthFar: 5,
    /** Screen Y of the horizon, for the depth proxy where there is no map. */
    horizonY: 6,
    outputWidth: 7,
    outputHeight: 8,
    /** -1 left, +1 right — `eye` mode only. */
    eyeSign: 9,
    /** 1 = blur the disocclusion fill (off under reduced motion). */
    fillBlur: 10,
    /**
     * The output frustum as ray tangents (x right, y up, at z = 1): centre and
     * half extent. Equal to the packed frame's (0, 0, tanHalfH, tanHalfV) on a
     * flat display; a WebXR eye's own, usually asymmetric, frustum.
     */
    outCentreX: 12,
    outCentreY: 13,
    outHalfX: 14,
    outHalfY: 15,
    /** `sourceFromOutput`, a rotation as three vec4 columns (w unused): 16–18, 20–22, 24–26. */
    rotation: 16,
} as const;

/** A 3×3 matrix, column-major (`m[c * 3 + r]`), x right / y up / z forward. */
export type Mat3 = readonly number[];

export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mulMat3(a: Mat3, b: Mat3): number[] {
    const out = new Array<number>(9);
    for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) {
            out[c * 3 + r] = a[r]! * b[c * 3]! + a[3 + r]! * b[c * 3 + 1]! + a[6 + r]! * b[c * 3 + 2]!;
        }
    }
    return out;
}

/** About x: + tips the forward ray up. */
export function rotX(rad: number): Mat3 {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** About y: + swings the forward ray right (a heading increase). */
export function rotY(rad: number): Mat3 {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [c, 0, -s, 0, 1, 0, s, 0, c];
}

/**
 * The rotation from a live camera's rays to the packed camera's. A camera is
 * `Ry(heading) · Rx(pitch)`, so this is `Rx(−packedPitch) · Ry(Δheading) · Rx(livePitch)`
 * (yaw and pitch do not commute away from level, so both pitches are absolute).
 */
export function latchRotation(packedPitchDeg: number, yawDeg: number, livePitchDeg: number): Mat3 {
    return mulMat3(mulMat3(rotX(-packedPitchDeg * DEG), rotY(yawDeg * DEG)), rotX(livePitchDeg * DEG));
}

/**
 * The rotation from an eye's rays to the packed camera's, for an eye with a
 * full orientation (a headset: roll included). `worldFromEye` maps eye rays to
 * world rays in this module's convention (x east, y up, z north at heading 0).
 */
export function sourceFromEyeRotation(packed: Pick<PovSample, 'heading' | 'pitch'>, worldFromEye: Mat3): Mat3 {
    return mulMat3(mulMat3(rotX(-packed.pitch * DEG), rotY(-packed.heading * DEG)), worldFromEye);
}

export interface PovSample {
    /** Degrees, any range (wrapped here). */
    heading: number;
    /** Degrees, + = up. */
    pitch: number;
    /** Store zoom, 1–3. */
    zoom: number;
}

/** Shortest signed heading difference `b − a`, degrees in (−180, 180]. */
export function wrapHeadingDelta(a: number, b: number): number {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
}

export interface LatchDelta {
    yawDeg: number;
    pitchDeg: number;
    /** Angular size of the correction, for the probe. */
    magnitudeDeg: number;
}

/** What the tail must rotate the packed frame by to show the live POV. */
export function latchDelta(packed: PovSample, live: PovSample): LatchDelta {
    const yawDeg = wrapHeadingDelta(packed.heading, live.heading);
    const pitchDeg = live.pitch - packed.pitch;
    return { yawDeg, pitchDeg, magnitudeDeg: Math.hypot(yawDeg, pitchDeg) };
}

/**
 * A rotation's turn of the forward ray as a latch delta — for the probe when
 * the rotation is not a yaw/pitch pair (a WebXR eye).
 */
export function rotationDelta(m: Mat3): LatchDelta {
    const [fx, fy, fz] = [m[6]!, m[7]!, m[8]!];
    return {
        yawDeg: Math.atan2(fx, fz) / DEG,
        pitchDeg: Math.asin(Math.max(-1, Math.min(1, fy))) / DEG,
        magnitudeDeg: Math.acos(Math.max(-1, Math.min(1, fz))) / DEG,
    };
}

/**
 * Horizontal FOV the road frame shows: the Maps panorama's own FOV at its
 * (integer) zoom, narrowed by pass 1's digital zoom.
 */
export function displayedHorizontalFov(zoom: number): number {
    const z = Math.max(1, zoom);
    return 180 / 2 ** Math.floor(z) / z;
}

export interface ReprojectUniformInput {
    mode: ReprojectMode;
    /** Display zoom (store zoom). */
    zoom: number;
    outputWidth: number;
    outputHeight: number;
    /** The latch rotation; zero for a frame shown as packed. Ignored with `rotation`. */
    delta: Pick<LatchDelta, 'yawDeg' | 'pitchDeg'>;
    /** Pitch the frame was packed with, degrees (yaw and pitch do not commute away from level). */
    packedPitchDeg?: number;
    /** `sourceFromOutput` when the output is not a yaw/pitch camera (a WebXR eye). */
    rotation?: Mat3;
    /** The output's frustum as tangents; default the packed frame's own. */
    outFrustum?: OutputFrustum;
    ipd?: number;
    convergence?: number;
    horizonY?: number;
    eyeSign?: -1 | 1;
    fillBlur?: boolean;
}

/** Ray tangents (x right, y up, at z = 1) of a frustum's edges — WebXR's `fieldOfView` shape. */
export interface OutputFrustum {
    left: number;
    right: number;
    down: number;
    up: number;
}

/**
 * Pack `ReprojectUniforms`. The FOV is per *eye image*: side-by-side halves
 * keep the full frame's FOV (each eye is squeezed, as a 3D TV expects).
 */
export function packReprojectUniforms(
    input: ReprojectUniformInput,
    out: Float32Array<ArrayBuffer> = new Float32Array(REPROJECT_UNIFORM_FLOAT_COUNT),
): Float32Array<ArrayBuffer> {
    const I = ReprojectUniformIndex;
    const hfov = displayedHorizontalFov(input.zoom) * DEG;
    const tanHalfH = Math.tan(hfov / 2);
    const aspect = input.outputHeight > 0 ? input.outputWidth / input.outputHeight : 1;
    const tanHalfV = tanHalfH / (aspect > 0 ? aspect : 1);
    const stereo = input.mode === 'sbs' || input.mode === 'anaglyph' || input.mode === 'eye';
    out.fill(0);
    out[I.mode] = REPROJECT_MODE_CODE[input.mode];
    out[I.tanHalfH] = tanHalfH;
    out[I.tanHalfV] = tanHalfV;
    out[I.halfIpd] = stereo ? (input.ipd ?? DEFAULT_IPD_METRES) / 2 : 0;
    out[I.convergenceInv] = 1 / (input.convergence ?? DEFAULT_CONVERGENCE_METRES);
    out[I.depthFar] = DEPTH_FAR_METRES;
    out[I.horizonY] = input.horizonY ?? 0.5;
    out[I.outputWidth] = input.outputWidth;
    out[I.outputHeight] = input.outputHeight;
    out[I.eyeSign] = input.eyeSign ?? -1;
    out[I.fillBlur] = input.fillBlur === false ? 0 : 1;
    const f = input.outFrustum ?? { left: -tanHalfH, right: tanHalfH, down: -tanHalfV, up: tanHalfV };
    out[I.outCentreX] = (f.right + f.left) / 2;
    out[I.outCentreY] = (f.up + f.down) / 2;
    out[I.outHalfX] = (f.right - f.left) / 2;
    out[I.outHalfY] = (f.up - f.down) / 2;
    const packedPitch = input.packedPitchDeg ?? 0;
    const m = input.rotation ?? latchRotation(packedPitch, input.delta.yawDeg, packedPitch + input.delta.pitchDeg);
    for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) out[I.rotation + c * 4 + r] = m[c * 3 + r]!;
    }
    return out;
}

/** The mode a frame needs: a stereo mode always runs; a mono frame copies when there is nothing to latch. */
export function resolveReprojectMode(stereo: 'off' | 'sbs' | 'anaglyph', delta: LatchDelta): ReprojectMode {
    if (stereo !== 'off') return stereo;
    return delta.yawDeg === 0 && delta.pitchDeg === 0 ? 'copy' : 'latch';
}

// ── CPU reference of reproject.wgsl ─────────────────────────────────────────

export type Vec2 = [number, number];

/**
 * Mirror of WGSL `latchSourceUV`: the UV in the packed frame that the output
 * sees at `uv` — the output ray (its own frustum) turned by `sourceFromOutput`
 * and projected into the packed camera.
 */
export function latchSourceUV(uv: Vec2, u: ArrayLike<number>): Vec2 {
    const I = ReprojectUniformIndex;
    const ex = u[I.outCentreX]! + (uv[0] * 2 - 1) * u[I.outHalfX]!;
    const ey = u[I.outCentreY]! + (1 - uv[1] * 2) * u[I.outHalfY]!;
    const col = (c: number, r: number) => u[I.rotation + c * 4 + r]!;
    const x = col(0, 0) * ex + col(1, 0) * ey + col(2, 0);
    const y = col(0, 1) * ex + col(1, 1) * ey + col(2, 1);
    const z = Math.max(col(0, 2) * ex + col(1, 2) * ey + col(2, 2), 1e-4);
    return [(x / z / u[I.tanHalfH]! + 1) * 0.5, (1 - y / z / u[I.tanHalfV]!) * 0.5];
}

/** Mirror of WGSL `viewDepthProxy` (normalised depth, 1 = horizon or beyond). */
export function viewDepthProxy(uvY: number, horizonY: number): number {
    const below = uvY - horizonY;
    if (below <= 0) return 1;
    return Math.min(Math.max(0.06 / Math.max(below, 0.0025), 0), 1);
}

/**
 * Mirror of WGSL `eyeShift`: how far (in UV, + = right) a centre-image point
 * at normalised depth `d` moves in the eye `eyeSign` (−1 left, +1 right).
 */
export function eyeShift(d: number, eyeSign: number, u: ArrayLike<number>): number {
    const I = ReprojectUniformIndex;
    const metres = Math.max(Math.min(d, 1) * u[I.depthFar]!, DEPTH_NEAR_METRES);
    // The sky (d = 1) is at infinity, not 27 m.
    const inv = d >= 1 ? 0 : 1 / metres;
    // Left eye (sign −1) sits left of centre, so the scene moves right in it.
    return -eyeSign * u[I.halfIpd]! * (inv - u[I.convergenceInv]!) / (2 * u[I.tanHalfH]!);
}

/** The farthest and nearest shift an eye can see — the search range. */
export function eyeShiftRange(eyeSign: number, u: ArrayLike<number>): Vec2 {
    const far = eyeShift(1, eyeSign, u);
    const near = eyeShift(DEPTH_NEAR_METRES / u[ReprojectUniformIndex.depthFar]!, eyeSign, u);
    return [far, near];
}

export interface StereoSample {
    /** Centre-image X the eye pixel takes its colour from. */
    x: number;
    /** False where the pixel was disoccluded and filled from the far side. */
    consistent: boolean;
}

/**
 * Mirror of WGSL `stereoSourceX`: the centre-image X an eye pixel at `x`
 * shows. `depthAt(x)` is the normalised depth of the centre image at X (the
 * shader samples the scene-depth map blended with the proxy).
 */
export function stereoSourceX(
    x: number,
    eyeSign: number,
    depthAt: (x: number) => number,
    u: ArrayLike<number>,
    steps: number = STEREO_SEARCH_STEPS,
): StereoSample {
    const [far, near] = eyeShiftRange(eyeSign, u);
    const span = near - far;
    const tol = Math.abs(span) / (steps - 1);
    let fillX = x - far;
    let fillShift = Number.POSITIVE_INFINITY;
    // Nearest candidate first: a consistent near surface occludes what is behind it.
    for (let i = 0; i < steps; i++) {
        const s = near - (span * i) / (steps - 1);
        const cx = x - s;
        const sc = eyeShift(depthAt(cx), eyeSign, u);
        if (Math.abs(sc - s) <= tol) return { x: cx, consistent: true };
        // Track the farthest surface seen (smallest |shift| toward `far`);
        // among equals the later tap, which lies nearest the occluder's edge.
        const farness = Math.abs(sc - far);
        if (farness <= fillShift) {
            fillShift = farness;
            fillX = cx;
        }
    }
    return { x: fillX, consistent: false };
}
