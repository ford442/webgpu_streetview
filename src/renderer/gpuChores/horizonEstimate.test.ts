import {
  estimateHorizonFromRows,
  HORIZON_IDLE,
  HORIZON_OFF,
  HORIZON_ROWS_HEIGHT,
  HORIZON_ROWS_WIDTH,
  predictedHorizonY,
  resolveHorizonFrame,
  rowLumaMeans,
  viewHorizonYReference,
  type HorizonFrameInput,
  type HorizonFrameState,
} from './horizonEstimate';

const W = HORIZON_ROWS_WIDTH;
const H = HORIZON_ROWS_HEIGHT;

/** Sky grey `sky` above row `split`, ground grey `ground` below. */
function splitFrame(split: number, sky = 200, ground = 70): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    const v = y < split ? sky : ground;
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

function rowsOf(rgba: Uint8Array): Float32Array {
  return rowLumaMeans(rgba, W, H);
}

function frame(overrides: Partial<HorizonFrameInput>): HorizonFrameInput {
  return {
    weight: 0.7,
    holdActive: false,
    rows: null,
    rowsPitch: 0.5,
    rowsSeq: 0,
    livePitch: 0.5,
    ...overrides,
  };
}

describe('rowLumaMeans', () => {
  it('returns one Rec.709 mean per row in [0, 1]', () => {
    const rows = rowsOf(splitFrame(10, 255, 0));
    expect(rows).toHaveLength(H);
    expect(rows[0]).toBeCloseTo(1, 5);
    expect(rows[H - 1]).toBeCloseTo(0, 5);
  });
});

describe('estimateHorizonFromRows', () => {
  it('finds a level horizon at mid-frame', () => {
    const est = estimateHorizonFromRows(rowsOf(splitFrame(H / 2)));
    expect(est).not.toBeNull();
    expect(est!.y).toBeCloseTo(0.5, 5);
  });

  it('finds a pitched horizon high in the frame', () => {
    const split = Math.round(H * 0.3);
    const est = estimateHorizonFromRows(rowsOf(splitFrame(split)));
    expect(est!.y).toBeCloseTo(split / H, 5);
  });

  it('rejects a flat frame', () => {
    expect(estimateHorizonFromRows(rowsOf(splitFrame(H / 2, 128, 124)))).toBeNull();
  });

  it('rejects a dark (night / tunnel) frame', () => {
    expect(estimateHorizonFromRows(rowsOf(splitFrame(H / 2, 30, 4)))).toBeNull();
  });

  it('rejects a frame whose ground is brighter than its sky', () => {
    expect(estimateHorizonFromRows(rowsOf(splitFrame(H / 2, 60, 200)))).toBeNull();
  });
});

describe('resolveHorizonFrame', () => {
  it('weight 0 → blend 0 and the state is untouched', () => {
    const state: HorizonFrameState = { bias: 0.1, lastSeq: 3 };
    const out = resolveHorizonFrame(
      frame({ weight: 0, rows: rowsOf(splitFrame(10)), rowsSeq: 4 }),
      state,
    );
    expect(out.uniforms).toBe(HORIZON_OFF);
    expect(out.state).toBe(state);
  });

  it('no accepted estimate yet → blend 0 (pitch-only horizon)', () => {
    const out = resolveHorizonFrame(frame({}), HORIZON_IDLE);
    expect(out.uniforms.blend).toBe(0);
    const flat = resolveHorizonFrame(
      frame({ rows: rowsOf(splitFrame(H / 2, 128, 126)), rowsSeq: 1 }),
      HORIZON_IDLE,
    );
    expect(flat.uniforms.blend).toBe(0);
    expect(flat.state.bias).toBeNull();
  });

  it('level frame at level pitch → zero bias', () => {
    const out = resolveHorizonFrame(
      frame({ rows: rowsOf(splitFrame(H / 2)), rowsSeq: 1 }),
      HORIZON_IDLE,
    );
    expect(out.state.bias).toBeCloseTo(0, 6);
    expect(out.uniforms.estimateY).toBeCloseTo(0.5, 6);
    expect(out.uniforms.blend).toBeCloseTo(0.7);
  });

  it('pitched panorama: re-projects the bias onto the live pitch', () => {
    // Camera reports level, but the image horizon sits at 0.375.
    const split = 18;
    const first = resolveHorizonFrame(
      frame({ rows: rowsOf(splitFrame(split)), rowsSeq: 1, rowsPitch: 0.5, livePitch: 0.5 }),
      HORIZON_IDLE,
    );
    const bias = split / H - 0.5;
    expect(first.state.bias).toBeCloseTo(bias, 6);
    // User then pitches up; same rows (no new sample) — estimate follows pitch.
    const panned = resolveHorizonFrame(
      frame({ rows: rowsOf(splitFrame(split)), rowsSeq: 1, livePitch: 0.55 }),
      first.state,
    );
    expect(panned.uniforms.estimateY).toBeCloseTo(predictedHorizonY(0.55) + bias, 6);
  });

  it('rejects an estimate too far from the pitch prediction', () => {
    const out = resolveHorizonFrame(
      frame({ rows: rowsOf(splitFrame(3)), rowsSeq: 1, rowsPitch: 0.7 }),
      HORIZON_IDLE,
    );
    expect(out.state.bias).toBeNull();
    expect(out.uniforms.blend).toBe(0);
  });

  it('freezes the last accepted horizon through a hold and resumes after release', () => {
    const accepted = resolveHorizonFrame(
      frame({ rows: rowsOf(splitFrame(20)), rowsSeq: 1 }),
      HORIZON_IDLE,
    ).state;
    const held = resolveHorizonFrame(
      frame({ holdActive: true, rows: rowsOf(splitFrame(30)), rowsSeq: 2 }),
      accepted,
    );
    expect(held.state.bias).toBe(accepted.bias);
    expect(held.state.lastSeq).toBe(1);
    expect(held.uniforms.blend).toBeCloseTo(0.7);

    const released = resolveHorizonFrame(
      frame({ rows: rowsOf(splitFrame(30)), rowsSeq: 2 }),
      held.state,
    );
    expect(released.state.lastSeq).toBe(2);
    expect(released.state.bias!).toBeGreaterThan(accepted.bias!);
  });

  it('integrates each published sample once', () => {
    const rows = rowsOf(splitFrame(20));
    const a = resolveHorizonFrame(frame({ rows, rowsSeq: 1 }), HORIZON_IDLE);
    const b = resolveHorizonFrame(frame({ rows: rowsOf(splitFrame(30)), rowsSeq: 1 }), a.state);
    expect(b.state).toBe(a.state);
  });
});

describe('viewHorizonYReference (WGSL mirror)', () => {
  const pitchOnly = (pitch: number) => Math.min(Math.max(0.5 + (pitch - 0.5) * 2.0, -0.75), 1.75);

  it('blend 0 matches the pitch-only horizon exactly for any estimate', () => {
    for (let pitch = -0.2; pitch <= 1.2; pitch += 0.01) {
      for (const estimateY of [-5, 0, 0.3, 0.5, 2, Number.NaN]) {
        expect(viewHorizonYReference(pitch, estimateY, 0)).toBe(pitchOnly(pitch));
        expect(viewHorizonYReference(pitch, estimateY, HORIZON_OFF.blend)).toBe(pitchOnly(pitch));
      }
    }
  });

  it('blend 1 lands on the (clamped) estimate', () => {
    expect(viewHorizonYReference(0.5, 0.3, 1)).toBeCloseTo(0.3, 10);
    expect(viewHorizonYReference(0.5, 9, 1)).toBe(1.75);
  });
});
