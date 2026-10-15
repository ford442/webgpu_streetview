/**
 * src/wasm/cabinDspTwin.ts
 * JS twin of cpp/src/cabin_dsp_module.cpp (the dsp_* cabin engine), bit-exact.
 *
 * The production engine runs as WASM inside the AudioWorklet; this twin is
 * what `JS_FALLBACK.createCabinDsp` returns and what
 * src/wasm/__tests__/cabinDspParity.test.ts pins to the same golden scripts as
 * the host C++ and both shipped binaries. Read it side by side with the C++:
 * same names, same statement order, and every f32 expression rounded after
 * each op (`f = Math.fround`) with pre-rounded constants. The FIR uses the
 * canonical four-lane summation order the SIMD build vectorises.
 */
import type { CabinDsp, CabinDspParams } from './abi';
import { engineTone, hashU32, hashUnit, hrtfShadow } from './audioKernels';

const f = Math.fround;

const QUANTUM = 128;
const MAX_IR_TAPS = 4096;
const HISTORY_OFFSET = MAX_IR_TAPS - 1;
const HISTORY_LEN = HISTORY_OFFSET + QUANTUM;
const XFADE_FRAMES = 256;
const INV_XFADE_FRAMES = 1 / 256;
const ITD_RING = 256;
const ITD_MASK = ITD_RING - 1;

const TWO_PI = f(6.2831855);
const SMOOTH_SECONDS = f(0.04);
const INV_SPEED_FULL_MPS = f(0.025);
const ENGINE_GAIN = f(0.42);
const RUMBLE_HZ = 110;
const RUMBLE_GAIN = f(2.6);
const HISS_SPLIT_HZ = 2200;
const DRY_HISS_GAIN = f(0.02);
const WET_HISS_GAIN = f(0.12);
const SPRAY_GAIN = f(1.4);
const WIND_LO_HZ = 250;
const WIND_HI_HZ = 1600;
const WIND_BASE_HZ = 90;
const WIND_GAIN = f(0.9);
const GUST_HZ = f(0.6);
const GUST_SCALE = 18;
const DROP_RATE_PER_SEC = 1400;
const DROP_DECAY_SECONDS = f(0.0025);
const DRUM_HZ = 400;
const DRUM_GAIN = f(0.55);
const TICK_GAIN = f(0.1);
const RAIN_HISS_HZ = 5000;
const RAIN_HISS_GAIN = f(0.05);
const WIPER_RAIN_MIN = f(0.02);
const WIPER_BASE_HZ = f(0.6);
const WIPER_RAIN_HZ = f(0.6);
const THUMP_HZ = 55;
const THUMP_DECAY_SECONDS = f(0.06);
const THUMP_GAIN = f(0.25);
const OCC_CLOSED_HZ = 700;
const OCC_OPEN_HZ = 6000;
const DC_HZ = 20;
const INV_255 = f(1 / 255);
const INV_24 = f(1 / 24);
const INPUT_LIMIT = 8;
const WIND_AZIMUTH = -55;
const SPEAKER_AZIMUTH = 30;

const F_0_2 = f(0.2);
const F_0_22 = f(0.22);
const F_0_25 = 0.25;
const F_0_3 = f(0.3);
const F_0_35 = f(0.35);
const F_0_4 = f(0.4);
const F_0_6 = f(0.6);
const F_0_65 = f(0.65);
const F_0_7 = f(0.7);
const F_0_75 = 0.75;
const F_0_78 = f(0.78);
const F_0_8 = f(0.8);
const F_1_25 = 1.25;

const SEED_ROAD_L = 0x9e3779b9;
const SEED_ROAD_R = 0x3c6ef372;
const SEED_WIND = 0xdaa66d2b;
const SEED_GUST = 0x78dde6e4;
const SEED_DROP = 0x1715609d;
const SEED_TICK = 0xb54cda56;
const SEED_RAIN_L = 0x5384540f;
const SEED_RAIN_R = 0xf1bbcdc8;
const SEED_PAN = 0x8ff34781;

// Parameter slots (the C++ `Param` enum).
const RPM = 0;
const LOAD = 1;
const SPEED = 2;
const OPEN = 3;
const WET = 4;
const RAIN = 5;
const WIND = 6;
const RADIO = 7;
const VEH_ENGINE = 8;
const VEH_ROAD = 9;
const VEH_WIND = 10;
const PARAM_COUNT = 11;

/** `kVehicleVoices`: engine, road, wind per CABIN_IR_VEHICLE_INDEX. */
const VEHICLE_VOICES: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [f(1.05), f(1.1), f(1.3)],
  [f(0.9), f(1.2), f(0.9)],
  [f(0.6), f(0.6), f(0.65)],
  [f(1.35), f(1.05), f(1.1)],
];

function clampf(v: number, lo: number, hi: number): number {
  if (!(v >= lo)) return lo;
  if (v > hi) return hi;
  return v;
}

function poleCoeff(hz: number, sampleRate: number): number {
  const a = f(f(TWO_PI * hz) / sampleRate);
  return a > 1 ? 1 : a;
}

function white(base: number, seed: number): number {
  return f(f(hashUnit(hashU32((base ^ seed) >>> 0)) * 2) - 1);
}

class HrtfVoice {
  readonly delay: number;
  readonly farGain: number;
  readonly damp: number;
  readonly rightIsNear: boolean;
  private readonly ring = new Float32Array(ITD_RING);
  private pos = 0;
  private farY = 0;
  /** Output of the last step: [left, right] contributions. */
  l = 0;
  r = 0;

  constructor(azimuthDeg: number, sampleRate: number) {
    const s = hrtfShadow(azimuthDeg, sampleRate);
    this.delay = s.delay < 0 ? 0 : s.delay > ITD_MASK ? ITD_MASK : s.delay;
    this.farGain = s.farGain;
    this.damp = s.damp;
    this.rightIsNear = s.rightIsNear;
  }

  /** `hrtf_voice_step`: adds the near/far ear signals to (l, r). */
  step(x: number, l: number, r: number): void {
    this.ring[this.pos] = x;
    const delayed = this.ring[(this.pos - this.delay) & ITD_MASK]!;
    this.pos = (this.pos + 1) & ITD_MASK;
    this.farY = f(this.farY + f(this.damp * f(f(this.farGain * delayed) - this.farY)));
    if (this.rightIsNear) {
      this.r = f(r + x);
      this.l = f(l + this.farY);
    } else {
      this.l = f(l + x);
      this.r = f(r + this.farY);
    }
  }
}

/** The canonical FIR dot product: four lane sums, then (a0 + a1) + (a2 + a3). */
function firDot(hr: Float32Array, x: Float32Array, xOff: number, n: number): number {
  let a0 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let j = 0; j < n; j += 4) {
    const o = xOff + j;
    a0 = f(a0 + f(hr[j]! * x[o]!));
    a1 = f(a1 + f(hr[j + 1]! * x[o + 1]!));
    a2 = f(a2 + f(hr[j + 2]! * x[o + 2]!));
    a3 = f(a3 + f(hr[j + 3]! * x[o + 3]!));
  }
  return f(f(a0 + a1) + f(a2 + a3));
}

export class CabinDspTwin implements CabinDsp {
  private readonly invSampleRate: number;
  private readonly smoothK: number;
  private readonly target = new Float32Array(PARAM_COUNT);
  private readonly current = new Float32Array(PARAM_COUNT);
  private wipers = 0;

  private readonly rumbleA: number;
  private readonly hissA: number;
  private readonly windALo: number;
  private readonly windAHi: number;
  private readonly windBaseA: number;
  private readonly gustA: number;
  private readonly dropDecay: number;
  private readonly dropPScale: number;
  private readonly drumA: number;
  private readonly rainHissA: number;
  private readonly occAClosed: number;
  private readonly occAOpen: number;
  private readonly dcR: number;
  private readonly thumpC1: number;
  private readonly thumpC2: number;
  private readonly thumpKick: number;

  private sample = 0;
  private enginePhase = 0;
  private wiperPhase = 0;
  private rumbleL = 0;
  private rumbleR = 0;
  private hissLpL = 0;
  private hissLpR = 0;
  private windLp1 = 0;
  private windLp2 = 0;
  private gust = 0;
  private dropEnv = 0;
  private dropPan = 0;
  private drumLp = 0;
  private rainLpL = 0;
  private rainLpR = 0;
  private thumpY1 = 0;
  private thumpY2 = 0;
  private occL = 0;
  private occR = 0;
  private dcXL = 0;
  private dcYL = 0;
  private dcXR = 0;
  private dcYR = 0;
  private readonly windVoice: HrtfVoice;
  private readonly radioLVoice: HrtfVoice;
  private readonly radioRVoice: HrtfVoice;

  private irCur = 0;
  private irLen = QUANTUM;
  private prevIrLen = QUANTUM;
  private xfadePos = XFADE_FRAMES;
  private readonly ir = [new Float32Array(MAX_IR_TAPS), new Float32Array(MAX_IR_TAPS)] as const;
  private readonly histL = new Float32Array(HISTORY_LEN);
  private readonly histR = new Float32Array(HISTORY_LEN);
  private readonly wetL = new Float32Array(QUANTUM);
  private readonly wetR = new Float32Array(QUANTUM);
  private readonly oldL = new Float32Array(QUANTUM);
  private readonly oldR = new Float32Array(QUANTUM);

  constructor(sampleRateIn: number) {
    let sr = f(sampleRateIn);
    if (!(sr > 1)) sr = 44100;
    if (sr > 192000) sr = 192000;
    this.invSampleRate = 1 / sr;
    this.smoothK = f(1 / f(SMOOTH_SECONDS * sr));

    this.rumbleA = poleCoeff(RUMBLE_HZ, sr);
    this.hissA = poleCoeff(HISS_SPLIT_HZ, sr);
    this.windALo = poleCoeff(WIND_LO_HZ, sr);
    this.windAHi = poleCoeff(WIND_HI_HZ, sr);
    this.windBaseA = poleCoeff(WIND_BASE_HZ, sr);
    this.gustA = poleCoeff(GUST_HZ, sr);
    this.dropDecay = f(1 - f(1 / f(DROP_DECAY_SECONDS * sr)));
    this.dropPScale = f(DROP_RATE_PER_SEC / sr);
    this.drumA = poleCoeff(DRUM_HZ, sr);
    this.rainHissA = poleCoeff(RAIN_HISS_HZ, sr);
    this.occAClosed = poleCoeff(OCC_CLOSED_HZ, sr);
    this.occAOpen = poleCoeff(OCC_OPEN_HZ, sr);
    this.dcR = f(1 - poleCoeff(DC_HZ, sr));

    const w = poleCoeff(THUMP_HZ, sr);
    const r = f(1 - f(1 / f(THUMP_DECAY_SECONDS * sr)));
    const w2 = f(w * w);
    const cosw = f(f(1 - f(w2 * 0.5)) + f(f(w2 * w2) * INV_24));
    this.thumpC1 = f(f(2 * r) * cosw);
    this.thumpC2 = f(r * r);
    this.thumpKick = w;

    this.windVoice = new HrtfVoice(WIND_AZIMUTH, sr);
    this.radioLVoice = new HrtfVoice(-SPEAKER_AZIMUTH, sr);
    this.radioRVoice = new HrtfVoice(SPEAKER_AZIMUTH, sr);

    this.ir[0][QUANTUM - 1] = 1;
    this.ir[1][QUANTUM - 1] = 1;
  }

  setParams(p: CabinDspParams): void {
    const t = this.target;
    t[RPM] = clampf(f(p.rpm), 0, 12000);
    t[LOAD] = clampf(f(p.load), 0, 1);
    t[SPEED] = clampf(f(p.speedMps), 0, 120);
    t[OPEN] = clampf(f(p.openness), 0, 1);
    t[WET] = clampf(f(p.wetRoad), 0, 1);
    t[RAIN] = clampf(f(p.rain), 0, 1);
    t[WIND] = clampf(f(p.windMps), 0, 60);
    t[RADIO] = clampf(f(p.radioGain), 0, 2);
    // A wasm i32 parameter is ToInt32 of the JS number.
    let vehicle = p.vehicle | 0;
    if (vehicle < 0) vehicle = 0;
    if (vehicle >= VEHICLE_VOICES.length) vehicle = VEHICLE_VOICES.length - 1;
    const v = VEHICLE_VOICES[vehicle]!;
    t[VEH_ENGINE] = v[0];
    t[VEH_ROAD] = v[1];
    t[VEH_WIND] = v[2];
    this.wipers = (Number(p.wipers) | 0) !== 0 ? 1 : 0;
  }

  setIr(taps: Float32Array | null, count: number = taps ? taps.length : 0): void {
    const identity = !taps || count <= 0;
    let n = identity ? 1 : count;
    if (n > MAX_IR_TAPS) n = MAX_IR_TAPS;
    const len = Math.trunc((n + QUANTUM - 1) / QUANTUM) * QUANTUM;
    const next = 1 - this.irCur;
    const hr = this.ir[next]!;
    hr.fill(0, 0, len);
    for (let t = 0; t < n; t++) {
      let v = identity ? 1 : f(taps![t] ?? 0);
      if (!(v >= -16 && v <= 16)) v = 0;
      hr[len - 1 - t] = v;
    }
    this.prevIrLen = this.irLen;
    this.irCur = next;
    this.irLen = len;
    this.xfadePos = 0;
  }

  render(
    radioL: Float32Array | null,
    radioR: Float32Array | null,
    outL: Float32Array | null,
    outR: Float32Array | null,
    frames: number,
  ): void {
    let done = 0;
    while (done < frames) {
      const chunk = Math.min(QUANTUM, frames - done);
      this.renderBlock(radioL, radioR, outL, outR, done, chunk);
      done += chunk;
    }
  }

  /** Nothing to free — the twin is garbage-collected. */
  destroy(): void {}

  private renderBlock(
    inL: Float32Array | null,
    inR: Float32Array | null,
    outL: Float32Array | null,
    outR: Float32Array | null,
    offset: number,
    frames: number,
  ): void {
    const k = this.smoothK;
    const c = this.current;
    const target = this.target;
    for (let i = 0; i < frames; i++) {
      for (let p = 0; p < PARAM_COUNT; p++) {
        c[p] = f(c[p]! + f(k * f(target[p]! - c[p]!)));
      }
      const open = c[OPEN]!;
      const rain = c[RAIN]!;

      // --- engine ---------------------------------------------------------
      const fund = f(c[RPM]! / 60);
      const eng = f(
        engineTone(this.enginePhase, f(F_0_22 + f(F_0_78 * c[LOAD]!)))
        * f(ENGINE_GAIN * c[VEH_ENGINE]!),
      );
      this.enginePhase += fund * this.invSampleRate;
      this.enginePhase -= Math.floor(this.enginePhase);

      // --- noise streams --------------------------------------------------
      const base = hashU32(this.sample);
      const wRoadL = white(base, SEED_ROAD_L);
      const wRoadR = white(base, SEED_ROAD_R);
      const wWind = white(base, SEED_WIND);
      const wGust = white(base, SEED_GUST);
      const wTick = white(base, SEED_TICK);
      const wRainL = white(base, SEED_RAIN_L);
      const wRainR = white(base, SEED_RAIN_R);
      const hDrop = hashU32((base ^ SEED_DROP) >>> 0);

      // --- road -----------------------------------------------------------
      let spd = f(c[SPEED]! * INV_SPEED_FULL_MPS);
      if (spd > 1) spd = 1;
      const roadGain = f(f(spd * f(F_0_35 + f(F_0_65 * spd))) * c[VEH_ROAD]!);
      const hissGain = f(DRY_HISS_GAIN + f(WET_HISS_GAIN * c[WET]!));
      const sprayGain = f(SPRAY_GAIN * c[WET]!);
      this.rumbleL = f(this.rumbleL + f(this.rumbleA * f(wRoadL - this.rumbleL)));
      this.rumbleR = f(this.rumbleR + f(this.rumbleA * f(wRoadR - this.rumbleR)));
      this.hissLpL = f(this.hissLpL + f(this.hissA * f(wRoadL - this.hissLpL)));
      this.hissLpR = f(this.hissLpR + f(this.hissA * f(wRoadR - this.hissLpR)));
      const roadL = f(f(f(f(this.rumbleL * RUMBLE_GAIN) + f(f(wRoadL - this.hissLpL) * hissGain))
        + f(f(this.hissLpL - this.rumbleL) * sprayGain)) * roadGain);
      const roadR = f(f(f(f(this.rumbleR * RUMBLE_GAIN) + f(f(wRoadR - this.hissLpR) * hissGain))
        + f(f(this.hissLpR - this.rumbleR) * sprayGain)) * roadGain);

      // --- wind -----------------------------------------------------------
      let w = f(f(c[SPEED]! + f(0.5 * c[WIND]!)) * INV_SPEED_FULL_MPS);
      if (w > 1) w = 1;
      const windA = f(this.windALo + f(f(this.windAHi - this.windALo) * w));
      this.windLp1 = f(this.windLp1 + f(windA * f(wWind - this.windLp1)));
      this.windLp2 = f(this.windLp2 + f(this.windBaseA * f(this.windLp1 - this.windLp2)));
      this.gust = f(this.gust + f(this.gustA * f(wGust - this.gust)));
      const gustAmp = clampf(f(F_0_75 + f(this.gust * GUST_SCALE)), F_0_25, F_1_25);
      const windSrc = f(f(f(f(this.windLp1 - this.windLp2) * f(f(w * w) * f(F_0_2 + f(F_0_8 * open))))
        * f(WIND_GAIN * c[VEH_WIND]!)) * gustAmp);

      // --- rain on the roof -----------------------------------------------
      if (hashUnit(hDrop) < f(rain * this.dropPScale)) {
        const amp = f(F_0_4 + f(F_0_6 * f((hDrop & 0xff) * INV_255)));
        if (amp > this.dropEnv) this.dropEnv = amp;
        this.dropPan = f(F_0_2 + f(F_0_6 * hashUnit(hashU32((base ^ SEED_PAN) >>> 0))));
      }
      const tick = f(this.dropEnv * wTick);
      this.dropEnv = f(this.dropEnv * this.dropDecay);
      this.drumLp = f(this.drumLp + f(this.drumA * f(tick - this.drumLp)));
      this.rainLpL = f(this.rainLpL + f(this.rainHissA * f(wRainL - this.rainLpL)));
      this.rainLpR = f(this.rainLpR + f(this.rainHissA * f(wRainR - this.rainLpR)));
      const drop = f(f(this.drumLp * f(DRUM_GAIN * f(1 - open)))
        + f(tick * f(TICK_GAIN * f(F_0_3 + f(F_0_7 * open)))));
      const hissAmp = f(rain * f(RAIN_HISS_GAIN * f(F_0_4 + f(F_0_6 * open))));
      const rainL = f(f(drop * f(1 - this.dropPan)) + f(this.rainLpL * hissAmp));
      const rainR = f(f(drop * this.dropPan) + f(this.rainLpR * hissAmp));

      // --- wiper thump ------------------------------------------------------
      let thumpIn = 0;
      if (this.wipers !== 0 && rain > WIPER_RAIN_MIN) {
        const before = this.wiperPhase;
        this.wiperPhase += f(WIPER_BASE_HZ + f(WIPER_RAIN_HZ * rain)) * this.invSampleRate;
        if (before < 0.5 && this.wiperPhase >= 0.5) thumpIn = this.thumpKick;
        if (this.wiperPhase >= 1) {
          this.wiperPhase -= 1;
          thumpIn = this.thumpKick;
        }
      }
      const thump = f(f(f(this.thumpC1 * this.thumpY1) - f(this.thumpC2 * this.thumpY2)) + thumpIn);
      this.thumpY2 = this.thumpY1;
      this.thumpY1 = thump;
      const thumpOut = f(thump * f(THUMP_GAIN * f(1 - f(0.5 * open))));

      // --- radio ------------------------------------------------------------
      const radioGain = c[RADIO]!;
      let rl = inL ? inL[offset + i]! : 0;
      let rr = inR ? inR[offset + i]! : 0;
      if (!(rl >= -INPUT_LIMIT && rl <= INPUT_LIMIT)) rl = 0;
      if (!(rr >= -INPUT_LIMIT && rr <= INPUT_LIMIT)) rr = 0;
      rl = f(rl * radioGain);
      rr = f(rr * radioGain);

      // --- place, occlude, mix ----------------------------------------------
      this.windVoice.step(windSrc, 0, 0);
      const windL = this.windVoice.l;
      const windR = this.windVoice.r;
      const occA = f(this.occAClosed + f(f(this.occAOpen - this.occAClosed) * open));
      this.occL = f(this.occL + f(occA * f(f(f(eng + roadL) + windL) - this.occL)));
      this.occR = f(this.occR + f(occA * f(f(f(eng + roadR) + windR) - this.occR)));

      this.radioLVoice.step(rl, 0, 0);
      this.radioRVoice.step(rr, this.radioLVoice.l, this.radioLVoice.r);
      const radioL = this.radioRVoice.l;
      const radioR = this.radioRVoice.r;

      this.histL[HISTORY_OFFSET + i] = f(f(f(this.occL + rainL) + thumpOut) + radioL);
      this.histR[HISTORY_OFFSET + i] = f(f(f(this.occR + rainR) + thumpOut) + radioR);
      this.sample = (this.sample + 1) >>> 0;
    }

    // --- cabin FIR, crossfading from the previous IR after a swap -----------
    const len = this.irLen;
    const hr = this.ir[this.irCur]!;
    for (let n = 0; n < frames; n++) {
      this.wetL[n] = firDot(hr, this.histL, HISTORY_OFFSET - (len - 1) + n, len);
      this.wetR[n] = firDot(hr, this.histR, HISTORY_OFFSET - (len - 1) + n, len);
    }
    const fading = this.xfadePos < XFADE_FRAMES;
    if (fading) {
      const plen = this.prevIrLen;
      const hp = this.ir[1 - this.irCur]!;
      for (let n = 0; n < frames; n++) {
        this.oldL[n] = firDot(hp, this.histL, HISTORY_OFFSET - (plen - 1) + n, plen);
        this.oldR[n] = firDot(hp, this.histR, HISTORY_OFFSET - (plen - 1) + n, plen);
      }
    }
    for (let n = 0; n < frames; n++) {
      let yl = this.wetL[n]!;
      let yr = this.wetR[n]!;
      if (this.xfadePos < XFADE_FRAMES) {
        const ol = this.oldL[n]!;
        const or = this.oldR[n]!;
        const g = (this.xfadePos + 1) * INV_XFADE_FRAMES;
        yl = f(ol + f(f(yl - ol) * g));
        yr = f(or + f(f(yr - or) * g));
        this.xfadePos++;
      }
      const dl = f(f(yl - this.dcXL) + f(this.dcR * this.dcYL));
      const dr = f(f(yr - this.dcXR) + f(this.dcR * this.dcYR));
      this.dcXL = yl;
      this.dcYL = dl;
      this.dcXR = yr;
      this.dcYR = dr;
      if (outL) outL[offset + n] = clampf(dl, -1, 1);
      if (outR) outR[offset + n] = clampf(dr, -1, 1);
    }

    this.histL.copyWithin(0, frames, frames + HISTORY_OFFSET);
    this.histR.copyWithin(0, frames, frames + HISTORY_OFFSET);
  }
}

/** Longest IR `setIr` keeps — `dsp_max_ir_taps()`. */
export const CABIN_DSP_MAX_IR_TAPS = MAX_IR_TAPS;
