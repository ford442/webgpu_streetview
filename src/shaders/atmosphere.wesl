// atmosphere.wgsl — the physically based atmosphere's look-up tables
// (Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique", EGSR 2020). Built by src/renderer/atmosphere/AtmosphereController.ts
// on change (sun elevation, conditions), never per frame for a still sun.
//
//   transmittance_lut   256x64  rgba16float  T to the top of the atmosphere over (mu, r)
//   multiscatter_lut     32x32  rgba16float  Psi_ms over (mu_s, r): the infinite-order term
//   skyview_lut         192x108 rgba16float  sky luminance at the observer over (azimuth to sun, zenith)
//   aerial_lut        32x32x32  rgba16float  in-scatter (rgb) + mean transmittance (a) over
//                                            (azimuth to sun, view elevation, distance)
//
// Every LUT is in the sun's frame: z up, the sun in the x-z plane. The sky is
// symmetric about the sun's vertical plane, so azimuth runs 0 (toward the sun)
// to pi, and a still sun needs no rebuild while the camera turns. The texel
// mappings are documented in atmosphereLayout.ts (slice 2's samplers invert them).
//
// `transmittance_lut` is the same 40-step midpoint integral as the C++
// reference (cpp/src/atmosphere_module.cpp, sw_atmo_transmittance_lut) at the
// same texels; e2e/atmosphere.spec.ts holds them within 1e-3. Lengths are km.

struct AtmosphereParams {
    // bottomRadius, topRadius, rayleighScaleHeight, mieScaleHeight
    radii: vec4<f32>,
    // rayleighScattering.rgb (/km), mieG
    rayleighG: vec4<f32>,
    // mieScattering.rgb, ozoneCenter
    mieScatOzoneCenter: vec4<f32>,
    // mieExtinction.rgb, ozoneHalfWidth
    mieExtOzoneWidth: vec4<f32>,
    // ozoneAbsorption.rgb, visibility (km)
    ozoneVisibility: vec4<f32>,
    // groundAlbedo.rgb, turbidity
    albedoTurbidity: vec4<f32>,
    // sin(sun elevation), cos(sun elevation), sun illuminance, unused
    sun: vec4<f32>,
    // observer altitude (km), aerial-perspective max distance (km), unused, unused
    observer: vec4<f32>,
}

@group(0) @binding(0) var<uniform> atmo: AtmosphereParams;
@group(0) @binding(1) var lutSampler: sampler;
@group(0) @binding(2) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(3) var multiscatterTex: texture_2d<f32>;
@group(0) @binding(4) var transmittanceOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var multiscatterOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var skyviewOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var aerialOut: texture_storage_3d<rgba16float, write>;

const PI: f32 = 3.14159265358979;
const TRANSMITTANCE_STEPS: i32 = 40;
const MULTISCATTER_DIRS_SQRT: i32 = 8;
const MULTISCATTER_STEPS: i32 = 20;
const SKYVIEW_STEPS: i32 = 30;
const AERIAL_SUBSTEPS: i32 = 2;
// Keeps the observer off the ground sphere so the horizon is well defined (Hillaire).
const PLANET_RADIUS_OFFSET_KM: f32 = 0.01;

fn bottomRadius() -> f32 { return atmo.radii.x; }
fn topRadius() -> f32 { return atmo.radii.y; }

struct Medium {
    scattering: vec3<f32>,
    extinction: vec3<f32>,
    rayleigh: vec3<f32>,
    mie: vec3<f32>,
}

fn sampleMedium(h: f32) -> Medium {
    let rhoR = exp(-h / atmo.radii.z);
    let rhoM = exp(-h / atmo.radii.w);
    let rhoO = max(0.0, 1.0 - abs(h - atmo.mieScatOzoneCenter.w) / atmo.mieExtOzoneWidth.w);
    var m: Medium;
    m.rayleigh = atmo.rayleighG.xyz * rhoR;
    m.mie = atmo.mieScatOzoneCenter.xyz * rhoM;
    m.scattering = m.rayleigh + m.mie;
    m.extinction = m.rayleigh + atmo.mieExtOzoneWidth.xyz * rhoM + atmo.ozoneVisibility.xyz * rhoO;
    return m;
}

fn distanceToTop(r: f32, mu: f32) -> f32 {
    let rt = topRadius();
    let disc = r * r * (mu * mu - 1.0) + rt * rt;
    return -r * mu + sqrt(max(disc, 0.0));
}

/** Nearest t >= 0 where ro + t * rd meets a sphere of `radius` at the origin; -1 for none. */
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, radius: f32) -> f32 {
    let b = dot(ro, rd);
    let c = dot(ro, ro) - radius * radius;
    let disc = b * b - c;
    if (disc < 0.0) { return -1.0; }
    let s = sqrt(disc);
    let t0 = -b - s;
    let t1 = -b + s;
    if (t0 >= 0.0) { return t0; }
    if (t1 >= 0.0) { return t1; }
    return -1.0;
}

fn rayleighPhase(c: f32) -> f32 {
    return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

/** Cornette-Shanks, as Hillaire. */
fn miePhase(c: f32) -> f32 {
    let g = atmo.rayleighG.w;
    let k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
    return k * (1.0 + c * c) / pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5);
}

// --- transmittance LUT mapping (Bruneton 2017), texel centres on the ends ----

fn unitToSubUv(x: f32, n: f32) -> f32 { return 0.5 / n + x * (1.0 - 1.0 / n); }

fn transmittanceUv(r: f32, mu: f32) -> vec2<f32> {
    let rg = bottomRadius();
    let rt = topRadius();
    let bigH = sqrt(rt * rt - rg * rg);
    let rho = sqrt(max(r * r - rg * rg, 0.0));
    let d = distanceToTop(r, mu);
    let dMin = rt - r;
    let dMax = rho + bigH;
    let xMu = (d - dMin) / max(dMax - dMin, 1e-6);
    let xR = rho / bigH;
    let size = vec2<f32>(textureDimensions(transmittanceTex));
    return vec2<f32>(unitToSubUv(xMu, size.x), unitToSubUv(xR, size.y));
}

fn sampleTransmittance(r: f32, mu: f32) -> vec3<f32> {
    return textureSampleLevel(transmittanceTex, lutSampler, transmittanceUv(r, mu), 0.0).rgb;
}

/** Transmittance from P toward `dir` to the top, or 0 when the ground is in the way. */
fn transmittanceToSun(p: vec3<f32>, dir: vec3<f32>) -> vec3<f32> {
    let r = length(p);
    let mu = dot(p, dir) / r;
    let ground = raySphere(p, dir, bottomRadius());
    if (ground > 0.0) { return vec3<f32>(0.0); }
    return sampleTransmittance(r, mu);
}

fn sampleMultiscatter(r: f32, muS: f32) -> vec3<f32> {
    let rg = bottomRadius();
    let rt = topRadius();
    let uv = clamp(vec2<f32>(muS * 0.5 + 0.5, (r - rg) / (rt - rg)), vec2<f32>(0.0), vec2<f32>(1.0));
    return textureSampleLevel(multiscatterTex, lutSampler, uv, 0.0).rgb;
}

fn sunDirection() -> vec3<f32> {
    return vec3<f32>(atmo.sun.y, 0.0, atmo.sun.x);
}

fn observerPosition() -> vec3<f32> {
    let r = bottomRadius() + max(atmo.observer.x, 0.0) + PLANET_RADIUS_OFFSET_KM;
    return vec3<f32>(0.0, 0.0, min(r, topRadius() - PLANET_RADIUS_OFFSET_KM));
}

/** Where a ray from `ro` leaves the medium: the ground (y = 1) or the top (y = 0). */
fn rayEnd(ro: vec3<f32>, rd: vec3<f32>) -> vec2<f32> {
    let ground = raySphere(ro, rd, bottomRadius());
    if (ground > 0.0) { return vec2<f32>(ground, 1.0); }
    return vec2<f32>(max(raySphere(ro, rd, topRadius()), 0.0), 0.0);
}

// --- 1. transmittance --------------------------------------------------------

@compute @workgroup_size(8, 8, 1)
fn transmittance_lut(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(transmittanceOut);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let rg = bottomRadius();
    let rt = topRadius();
    // Texel (i, j) is x_mu = i / (w - 1), x_r = j / (h - 1) — sw_atmo_transmittance_lut.
    let xMu = f32(id.x) / max(f32(size.x) - 1.0, 1.0);
    let xR = f32(id.y) / max(f32(size.y) - 1.0, 1.0);
    let bigH = sqrt(rt * rt - rg * rg);
    let rho = bigH * xR;
    let r = sqrt(rho * rho + rg * rg);
    let dMin = rt - r;
    let dMax = rho + bigH;
    let d = dMin + xMu * (dMax - dMin);
    var mu = 1.0;
    if (d != 0.0) { mu = clamp((bigH * bigH - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
    let dist = distanceToTop(r, mu);
    let dt = dist / f32(TRANSMITTANCE_STEPS);
    var depth = vec3<f32>(0.0);
    for (var i = 0; i < TRANSMITTANCE_STEPS; i++) {
        let t = (f32(i) + 0.5) * dt;
        let h = sqrt(max(t * t + 2.0 * r * mu * t + r * r, 0.0)) - rg;
        depth += sampleMedium(h).extinction * dt;
    }
    textureStore(transmittanceOut, vec2<i32>(id.xy), vec4<f32>(exp(-depth), 1.0));
}

// --- 2. multiple scattering (Hillaire §5.5) ----------------------------------

@compute @workgroup_size(8, 8, 1)
fn multiscatter_lut(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(multiscatterOut);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let rg = bottomRadius();
    let rt = topRadius();
    let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size);
    let muS = uv.x * 2.0 - 1.0;
    let r = rg + uv.y * (rt - rg) + PLANET_RADIUS_OFFSET_KM * (1.0 - uv.y);
    let ro = vec3<f32>(0.0, 0.0, r);
    let sunDir = vec3<f32>(sqrt(max(1.0 - muS * muS, 0.0)), 0.0, muS);
    let isotropic = 1.0 / (4.0 * PI);
    let albedo = atmo.albedoTurbidity.xyz;

    var lum = vec3<f32>(0.0);
    var fms = vec3<f32>(0.0);
    let n = f32(MULTISCATTER_DIRS_SQRT);
    for (var a = 0; a < MULTISCATTER_DIRS_SQRT; a++) {
        for (var b = 0; b < MULTISCATTER_DIRS_SQRT; b++) {
            // Uniform on the sphere: theta in azimuth, cos(phi) stratified.
            let theta = 2.0 * PI * (f32(a) + 0.5) / n;
            let cosPhi = 1.0 - 2.0 * (f32(b) + 0.5) / n;
            let sinPhi = sqrt(max(1.0 - cosPhi * cosPhi, 0.0));
            let rd = vec3<f32>(cos(theta) * sinPhi, sin(theta) * sinPhi, cosPhi);
            let end = rayEnd(ro, rd);
            let dt = end.x / f32(MULTISCATTER_STEPS);
            var throughput = vec3<f32>(1.0);
            for (var s = 0; s < MULTISCATTER_STEPS; s++) {
                let p = ro + rd * ((f32(s) + 0.5) * dt);
                let h = length(p) - rg;
                let m = sampleMedium(h);
                let stepT = exp(-m.extinction * dt);
                let ext = max(m.extinction, vec3<f32>(1e-9));
                let sun = transmittanceToSun(p, sunDir);
                let single = sun * m.scattering * isotropic;
                lum += throughput * (single - single * stepT) / ext;
                fms += throughput * (m.scattering - m.scattering * stepT) / ext;
                throughput *= stepT;
            }
            if (end.y > 0.5) {
                let p = ro + rd * end.x;
                let nrm = normalize(p);
                let sun = transmittanceToSun(p + nrm * 1e-3, sunDir);
                lum += throughput * sun * max(dot(nrm, sunDir), 0.0) * albedo / PI;
            }
        }
    }
    let count = n * n;
    // Sphere average x isotropic phase x 4 pi solid angle = the mean (Hillaire eq. 5-9).
    let l2 = lum / count;
    let f = fms / count * (4.0 * PI) * isotropic;
    let psi = l2 / max(vec3<f32>(1.0) - f, vec3<f32>(1e-4));
    textureStore(multiscatterOut, vec2<i32>(id.xy), vec4<f32>(psi, 1.0));
}

// --- shared single + multiple scattering raymarch ---------------------------

struct Scattered {
    luminance: vec3<f32>,
    throughput: vec3<f32>,
}

/** In-scattered luminance and transmittance over [t0, t1] along ro + t rd. */
fn integrate(ro: vec3<f32>, rd: vec3<f32>, t0: f32, t1: f32, steps: i32, carry: Scattered) -> Scattered {
    let rg = bottomRadius();
    let sunDir = sunDirection();
    let cosTheta = dot(rd, sunDir);
    let phaseR = rayleighPhase(cosTheta);
    let phaseM = miePhase(cosTheta);
    let illuminance = atmo.sun.z;
    var out = carry;
    let dt = (t1 - t0) / f32(steps);
    if (dt <= 0.0) { return out; }
    for (var s = 0; s < steps; s++) {
        let p = ro + rd * (t0 + (f32(s) + 0.5) * dt);
        let r = length(p);
        let m = sampleMedium(r - rg);
        let stepT = exp(-m.extinction * dt);
        let ext = max(m.extinction, vec3<f32>(1e-9));
        let sun = transmittanceToSun(p, sunDir);
        let muS = dot(p, sunDir) / r;
        let ms = sampleMultiscatter(r, muS);
        let source = illuminance * (sun * (m.rayleigh * phaseR + m.mie * phaseM) + ms * m.scattering);
        out.luminance += out.throughput * (source - source * stepT) / ext;
        out.throughput *= stepT;
    }
    return out;
}

// --- 3. sky view (Hillaire §5.3) ---------------------------------------------

@compute @workgroup_size(8, 8, 1)
fn skyview_lut(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(skyviewOut);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size);
    let ro = observerPosition();
    let r = ro.z;
    let rg = bottomRadius();
    // v: zenith angle, squeezed toward the horizon from both sides.
    let vHorizon = sqrt(max(r * r - rg * rg, 0.0));
    let beta = acos(clamp(vHorizon / r, -1.0, 1.0));
    let zenithHorizon = PI - beta;
    var zenith: f32;
    if (uv.y < 0.5) {
        var c = 1.0 - 2.0 * uv.y;
        c = 1.0 - c * c;
        zenith = zenithHorizon * c;
    } else {
        var c = uv.y * 2.0 - 1.0;
        c = c * c;
        zenith = zenithHorizon + beta * c;
    }
    // u: cosine of the azimuth to the sun, squeezed toward the sun.
    let cu = uv.x * uv.x;
    let cosAz = -(cu * 2.0 - 1.0);
    let sinAz = sqrt(max(1.0 - cosAz * cosAz, 0.0));
    let sinZ = sin(zenith);
    let rd = vec3<f32>(cosAz * sinZ, sinAz * sinZ, cos(zenith));
    let end = rayEnd(ro, rd);
    var acc: Scattered;
    acc.luminance = vec3<f32>(0.0);
    acc.throughput = vec3<f32>(1.0);
    acc = integrate(ro, rd, 0.0, end.x, SKYVIEW_STEPS, acc);
    textureStore(skyviewOut, vec2<i32>(id.xy), vec4<f32>(acc.luminance, 1.0));
}

// --- 4. aerial perspective (Hillaire §5.4, sun-relative instead of froxels) --

@compute @workgroup_size(8, 8, 1)
fn aerial_lut(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(aerialOut);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size.xy);
    // u: azimuth to the sun, linear in [0, pi]; v: elevation, linear in [-pi/2, pi/2].
    let az = uv.x * PI;
    let el = (uv.y * 2.0 - 1.0) * 0.5 * PI;
    let rd = vec3<f32>(cos(az) * cos(el), sin(az) * cos(el), sin(el));
    let ro = observerPosition();
    let end = rayEnd(ro, rd);
    let maxDist = atmo.observer.y;
    let slices = f32(size.z);
    var acc: Scattered;
    acc.luminance = vec3<f32>(0.0);
    acc.throughput = vec3<f32>(1.0);
    var t = 0.0;
    for (var k = 0u; k < size.z; k++) {
        // w = sqrt(d / maxDist) at slice centres: dense near the camera.
        let w = (f32(k) + 0.5) / slices;
        let dEnd = min(maxDist * w * w, end.x);
        acc = integrate(ro, rd, t, dEnd, AERIAL_SUBSTEPS, acc);
        t = max(t, dEnd);
        let meanT = dot(acc.throughput, vec3<f32>(1.0 / 3.0));
        textureStore(aerialOut, vec3<i32>(vec2<i32>(id.xy), i32(k)), vec4<f32>(acc.luminance, meanT));
    }
}
