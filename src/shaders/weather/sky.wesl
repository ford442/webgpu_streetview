import package::lib::noise::fbm;
import package::weather::bindings::{linearSampler, sceneTex};
import package::weather::night::starField;
import package::weather::semantic::{semParams, semanticSkyMatte};

// Perez's sky distribution for one channel of the Preetham model.
fn perezTerm(cosTheta: f32, gamma: f32, cosGamma: f32, a: f32, b: f32, c: f32, d: f32, e: f32) -> f32 {
    return (1.0 + a * exp(b / max(cosTheta, 0.01))) * (1.0 + c * exp(d * gamma) + e * cosGamma * cosGamma);
}

// Preetham analytic daylight sky (1999), linear sRGB, for a view direction
// and a sun direction (y up). The sun is held just above the horizon — below
// it the caller blends to the night sky.
fn preethamSky(dir: vec3<f32>, sunDir: vec3<f32>, turbidity: f32) -> vec3<f32> {
    let tb = turbidity;
    let thetaS = acos(clamp(sunDir.y, 0.03, 1.0));
    let cosThetaS = cos(thetaS);
    let cosTheta = max(dir.y, 0.0);
    let cosGamma = clamp(dot(dir, normalize(vec3<f32>(sunDir.x, max(sunDir.y, 0.03), sunDir.z))), -1.0, 1.0);
    let gamma = acos(cosGamma);
    let chi = (4.0 / 9.0 - tb / 120.0) * (3.14159265 - 2.0 * thetaS);
    let yz = max((4.0453 * tb - 4.9710) * tan(chi) - 0.2155 * tb + 2.4192, 0.05);
    let s1 = thetaS;
    let s2 = s1 * s1;
    let s3 = s2 * s1;
    let xz = tb * tb * (0.00166 * s3 - 0.00375 * s2 + 0.00209 * s1)
        + tb * (-0.02903 * s3 + 0.06377 * s2 - 0.03202 * s1 + 0.00394)
        + (0.11693 * s3 - 0.21196 * s2 + 0.06052 * s1 + 0.25886);
    let yzc = tb * tb * (0.00275 * s3 - 0.00610 * s2 + 0.00317 * s1)
        + tb * (-0.04214 * s3 + 0.08970 * s2 - 0.04153 * s1 + 0.00516)
        + (0.15346 * s3 - 0.26756 * s2 + 0.06670 * s1 + 0.26688);
    let lum = yz
        * perezTerm(cosTheta, gamma, cosGamma, 0.1787 * tb - 1.4630, -0.3554 * tb + 0.4275, -0.0227 * tb + 5.3251, 0.1206 * tb - 2.5771, -0.0670 * tb + 0.3703)
        / perezTerm(1.0, thetaS, cosThetaS, 0.1787 * tb - 1.4630, -0.3554 * tb + 0.4275, -0.0227 * tb + 5.3251, 0.1206 * tb - 2.5771, -0.0670 * tb + 0.3703);
    let cx = xz
        * perezTerm(cosTheta, gamma, cosGamma, -0.0193 * tb - 0.2592, -0.0665 * tb + 0.0008, -0.0004 * tb + 0.2125, -0.0641 * tb - 0.8989, -0.0033 * tb + 0.0452)
        / perezTerm(1.0, thetaS, cosThetaS, -0.0193 * tb - 0.2592, -0.0665 * tb + 0.0008, -0.0004 * tb + 0.2125, -0.0641 * tb - 0.8989, -0.0033 * tb + 0.0452);
    let cy = yzc
        * perezTerm(cosTheta, gamma, cosGamma, -0.0167 * tb - 0.2608, -0.0950 * tb + 0.0092, -0.0079 * tb + 0.2102, -0.0441 * tb - 1.6537, -0.0109 * tb + 0.0529)
        / perezTerm(1.0, thetaS, cosThetaS, -0.0167 * tb - 0.2608, -0.0950 * tb + 0.0092, -0.0079 * tb + 0.2102, -0.0441 * tb - 1.6537, -0.0109 * tb + 0.0529);
    let safeY = max(cy, 1e-4);
    let xyz = vec3<f32>(cx / safeY * lum, lum, (1.0 - cx - cy) / safeY * lum);
    let rgb = vec3<f32>(
        3.2406 * xyz.x - 1.5372 * xyz.y - 0.4986 * xyz.z,
        -0.9689 * xyz.x + 1.8758 * xyz.y + 0.0415 * xyz.z,
        0.0557 * xyz.x - 0.2040 * xyz.y + 1.0570 * xyz.z,
    );
    return max(rgb, vec3<f32>(0.0));
}

// World direction (x east, y up, z north) for a compass bearing and elevation (radians).
fn bearingDir(bearing: f32, elevation: f32) -> vec3<f32> {
    return vec3<f32>(cos(elevation) * sin(bearing), sin(elevation), cos(elevation) * cos(bearing));
}

// Sky replacement: behind the sky matte, the photo's sky is regraded to an
// analytic one — Preetham daylight from the real sun, domain-warped clouds
// whose cover follows the weather, stars and the moon at night — keeping the
// photograph's own cloud structure (see the end of the body). Only when the
// mood asks for a different sky (night, overcast/storm, fog, golden hour or
// sunrise): a clear midday keeps the photograph's own sky. Directions use the
// same ~90 degree vertical view as viewHorizonY; SunCalc azimuths are from
// south, so a compass bearing is azimuth + pi.
fn semanticSky(
    col: vec3<f32>, uv: vec2<f32>, aspect: f32, t: f32,
    cameraHeading: f32, cameraPitch: f32,
    sunAz: f32, sunAlt: f32, moonAz: f32, moonAlt: f32,
    night: f32, sunrise: f32, rainAmount: f32, snowAmount: f32, fogAmount: f32,
) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.skyReplace <= 0.0) { return col; }
    let sunElev = sin(sunAlt);
    let nightness = clamp(max(night, smoothstep(0.04, -0.12, sunElev)), 0.0, 1.0);
    let cloudiness = clamp(max(max(rainAmount * 0.9, snowAmount * 0.8), fogAmount * 0.7), 0.0, 1.0);
    let golden = smoothstep(0.35, 0.05, sunElev) * (1.0 - nightness);
    let mood = clamp(max(max(nightness, cloudiness), max(golden, sunrise)), 0.0, 1.0);
    if (mood <= 0.001) { return col; }
    let matte = semanticSkyMatte(uv) * mood * clamp(semParams.skyReplace, 0.0, 1.0);
    if (matte <= 0.001) { return col; }

    let heading = cameraHeading * 6.2831853;
    let pitch = (cameraPitch - 0.5) * 3.14159265;
    let fwd = bearingDir(heading, pitch);
    let right = vec3<f32>(cos(heading), 0.0, -sin(heading));
    let up = cross(fwd, right);
    let dir = normalize(fwd + right * ((uv.x - 0.5) * 2.0 * aspect) + up * ((0.5 - uv.y) * 2.0));
    let sunDir = bearingDir(sunAz + 3.14159265, sunAlt);
    let still = clamp(semParams.stillness, 0.0, 1.0);
    let drift = t * (1.0 - still);

    // Day: Preetham, hazier as the weather closes in.
    let turbidity = mix(2.6, 8.0, cloudiness);
    var sky = preethamSky(dir, sunDir, turbidity) * 0.075;
    sky = sky + vec3<f32>(1.0, 0.92, 0.8) * pow(max(dot(dir, sunDir), 0.0), 900.0) * 6.0 * (1.0 - cloudiness);

    // Night: a deep gradient, world-fixed stars, the moon.
    let elev = clamp(dir.y, -0.2, 1.0);
    // In the frame's own (display-referred) range, near applyNight's sky, so
    // the replaced sky does not open a black hole next to the graded photo.
    var nightSkyCol = mix(vec3<f32>(0.07, 0.1, 0.2), vec3<f32>(0.015, 0.025, 0.07), smoothstep(0.0, 0.6, elev));
    let starUv = vec2<f32>(atan2(dir.x, dir.z) * 0.159155 + 0.5, elev) * vec2<f32>(4.0, 2.0);
    nightSkyCol = nightSkyCol + vec3<f32>(0.9, 0.92, 1.0) * starField(starUv, 60.0, drift) * 0.5 * (1.0 - cloudiness);
    let moonDir = bearingDir(moonAz + 3.14159265, moonAlt);
    let moonDisk = smoothstep(0.99985, 0.99993, dot(dir, moonDir)) * select(0.0, 1.0, moonAlt > 0.0);
    nightSkyCol = nightSkyCol + vec3<f32>(0.85, 0.86, 0.8) * moonDisk * 0.8;
    sky = mix(sky, nightSkyCol, nightness);

    // Clouds on a plane above the eye, domain-warped fBm; cover follows the weather.
    let cover = clamp(0.25 + cloudiness * 0.75, 0.0, 1.0);
    let cloudUv = dir.xz / max(dir.y + 0.1, 0.1) * 0.35 + vec2<f32>(drift * 0.004, drift * 0.0015);
    let warp = vec2<f32>(fbm(vec3<f32>(cloudUv * 1.7, 1.3), 2), fbm(vec3<f32>(cloudUv * 1.7 + vec2<f32>(5.2, 1.7), 2.1), 2)) - vec2<f32>(0.5);
    let n = fbm(vec3<f32>((cloudUv + warp * 0.6) * 2.3, 0.4), 3);
    let density = smoothstep(1.0 - cover - 0.1, 1.0 - cover + 0.3, n + 0.15) * smoothstep(-0.02, 0.18, dir.y);
    let sunTint = mix(vec3<f32>(1.0), vec3<f32>(1.0, 0.62, 0.38), max(golden, sunrise));
    let dayCloud = sunTint * mix(0.85, 0.32, cloudiness * cloudiness) * clamp(0.25 + sunElev * 2.0, 0.2, 1.0);
    let cloudCol = mix(dayCloud, vec3<f32>(0.02, 0.022, 0.03), nightness);
    sky = mix(sky, cloudCol, density * 0.7);

    // A regrade, not a cut-out: the photograph's own sky structure (cloud
    // bodies, haze, grain) rides on the new sky as its luma over the photo's
    // mean sky luma (from semParams.skyR/G/B, measured where the map said sky).
    // Clouds stay brighter than the clear sky around them, so where the
    // network read a cloud as something else the seam is a change of colour,
    // not a flat slab against the photograph.
    let photo = dot(textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let skyRef = dot(vec3<f32>(semParams.skyR, semParams.skyG, semParams.skyB), vec3<f32>(0.2126, 0.7152, 0.0722));
    let ratio = select(1.0, clamp(photo / max(skyRef, 0.02), 0.3, 2.5), skyRef > 0.0);
    sky = sky * mix(1.0, ratio, 0.85);

    return mix(col, sky, clamp(matte, 0.0, 1.0) * 0.9);
}
