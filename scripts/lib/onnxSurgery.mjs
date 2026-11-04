/**
 * Just enough protobuf + ONNX to rebuild the semantic model (#352) at fetch
 * time, with no npm dependency: the source (Qualcomm AI Hub's DDRNet23-Slim
 * export, MIT) is a fixed 1024×2048 graph with external fp32 weights; the app
 * needs a self-contained, any-size graph fed by the depth pass's ImageNet-
 * normalised tensor. The rebuild is deterministic (same bytes in → same bytes
 * out), so its output is SHA-pinned like a downloaded file.
 *
 * Edits (`rebuildSemanticModel`):
 * 1. Drop the graph's own `(x − mean) / std` prologue (`Sub` + `Div` on the
 *    input): the Worker feeds the depth model's ImageNet tensor, which is the
 *    same normalisation, so one upload feeds both sessions.
 * 2. Make height/width symbolic; every `Resize` (all bilinear upsamples into
 *    an `Add`) takes its `sizes` from the `Add`'s other operand at run time
 *    (`Shape`/`Concat`) instead of the 1024×2048 constants.
 * 3. Inline the external weights as **fp16** with a `Cast` to fp32 in front of
 *    each (ORT constant-folds the casts at session create: fp32 compute, half
 *    the download). Small initializers (shape constants, < 64 elements) stay as
 *    they were.
 * 4. Drop `value_info` (fixed intermediate shapes would contradict step 2).
 * 5. (`classGroups`) Append the class head on the GPU: `Softmax` over the
 *    source classes, a fixed 1×1 `Conv` that sums them into the app's groups,
 *    and a bilinear `Resize` from the 1/8-scale logits back to the input size
 *    — so the Worker only takes a per-pixel argmax of a few channels.
 * 6. (`inputScale` > 1) Upsample the input bilinearly by that factor in front
 *    of the first layer. The depth tensor is ≈252² and a Cityscapes model sees
 *    street objects at that size as too small to segment (≈50% agreement with
 *    a 640 px run, vs ≈83% after ×2) — the shared tensor still feeds both
 *    sessions, and the head (edit 5) still resizes to the *un*-scaled input.
 */

// ---------------------------------------------------------------- protobuf

/** @typedef {{ f: number, w: number, v: bigint | Uint8Array }} PbField */

/** @param {Uint8Array} buf @param {number} pos @returns {[bigint, number]} */
function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('protobuf: truncated varint');
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7n;
  }
}

/** @param {bigint} value @param {number[]} out */
function writeVarint(value, out) {
  let v = BigInt.asUintN(64, value);
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(byte);
      return;
    }
    out.push(byte | 0x80);
  }
}

/** Decode one message level into its fields, in order. @param {Uint8Array} buf @returns {PbField[]} */
export function decode(buf) {
  /** @type {PbField[]} */
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, next] = readVarint(buf, pos);
    pos = next;
    const f = Number(key >> 3n);
    const w = Number(key & 7n);
    if (w === 0) {
      const [v, after] = readVarint(buf, pos);
      fields.push({ f, w, v });
      pos = after;
    } else if (w === 2) {
      const [len, after] = readVarint(buf, pos);
      const end = after + Number(len);
      if (end > buf.length) throw new Error('protobuf: truncated field');
      fields.push({ f, w, v: buf.subarray(after, end) });
      pos = end;
    } else if (w === 1 || w === 5) {
      const n = w === 1 ? 8 : 4;
      fields.push({ f, w, v: buf.subarray(pos, pos + n) });
      pos += n;
    } else {
      throw new Error(`protobuf: unsupported wire type ${w}`);
    }
  }
  return fields;
}

/** @param {PbField[]} fields @returns {Uint8Array} */
export function encode(fields) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  /** @type {number[]} */
  let small = [];
  const flush = () => {
    if (small.length) {
      const c = Uint8Array.from(small);
      chunks.push(c);
      total += c.length;
      small = [];
    }
  };
  for (const { f, w, v } of fields) {
    writeVarint(BigInt((f << 3) | w), small);
    if (w === 0) {
      writeVarint(/** @type {bigint} */ (v), small);
    } else if (w === 2) {
      const bytes = /** @type {Uint8Array} */ (v);
      writeVarint(BigInt(bytes.length), small);
      if (bytes.length < 256) {
        for (const b of bytes) small.push(b);
      } else {
        flush();
        chunks.push(bytes);
        total += bytes.length;
      }
    } else {
      for (const b of /** @type {Uint8Array} */ (v)) small.push(b);
    }
  }
  flush();
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();
/** @param {string} s */
const str = (s) => utf8.encode(s);
/** @param {PbField | undefined} field */
const text = (field) => (field ? utf8d.decode(/** @type {Uint8Array} */ (field.v)) : '');
/** @param {PbField[]} fields @param {number} f */
const first = (fields, f) => fields.find((x) => x.f === f);
/** @param {number} f @param {string} s @returns {PbField} */
const sField = (f, s) => ({ f, w: 2, v: str(s) });
/** @param {number} f @param {number | bigint} n @returns {PbField} */
const iField = (f, n) => ({ f, w: 0, v: BigInt(n) });
/** @param {number} f @param {PbField[]} m @returns {PbField} */
const mField = (f, m) => ({ f, w: 2, v: encode(m) });

// ------------------------------------------------------------------- ONNX

// Field numbers (onnx.proto3).
const MODEL_GRAPH = 7;
const GRAPH = { node: 1, initializer: 5, input: 11, output: 12, valueInfo: 13 };
const NODE = { input: 1, output: 2, name: 3, opType: 4, attribute: 5 };
const ATTR = { name: 1, i: 3, s: 4, type: 20 };
const ATTR_INT = 2;
const ATTR_STRING = 3;
const TENSOR = { dims: 1, dataType: 2, name: 8, raw: 9, external: 13, location: 14 };
const DT_FLOAT = 1;
const DT_FLOAT16 = 10;

/**
 * @param {{ op: string, name: string, inputs: string[], outputs: string[],
 *   ints?: Record<string, number>, strings?: Record<string, string> }} n
 */
function makeNode({ op, name, inputs, outputs, ints = {}, strings = {} }) {
  /** @type {PbField[]} */
  const fields = [];
  for (const i of inputs) fields.push(sField(NODE.input, i));
  for (const o of outputs) fields.push(sField(NODE.output, o));
  fields.push(sField(NODE.name, name), sField(NODE.opType, op));
  for (const [key, value] of Object.entries(ints)) {
    fields.push(mField(NODE.attribute, [sField(ATTR.name, key), iField(ATTR.i, value), iField(ATTR.type, ATTR_INT)]));
  }
  for (const [key, value] of Object.entries(strings)) {
    fields.push(mField(NODE.attribute, [sField(ATTR.name, key), sField(ATTR.s, value), iField(ATTR.type, ATTR_STRING)]));
  }
  return mField(GRAPH.node, fields);
}

/** @param {PbField[]} node */
const nodeInputs = (node) => node.filter((x) => x.f === NODE.input).map(text);
/** @param {PbField[]} node */
const nodeOutputs = (node) => node.filter((x) => x.f === NODE.output).map(text);
/** @param {PbField[]} node */
const nodeOp = (node) => text(first(node, NODE.opType));

/** float32 → float16 bits, round to nearest even (what `Math.f16round` does). @param {Float32Array} src */
export function toFloat16Bits(src) {
  const out = new Uint16Array(src.length);
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  for (let i = 0; i < src.length; i++) {
    f32[0] = src[i];
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    if (exp === 0xff) {
      out[i] = sign | 0x7c00 | (mant ? 0x200 : 0);
      continue;
    }
    let e = exp - 127 + 15;
    if (e >= 0x1f) {
      out[i] = sign | 0x7c00;
      continue;
    }
    if (e <= 0) {
      if (e < -10) {
        out[i] = sign;
        continue;
      }
      mant |= 0x800000;
      const shift = 14 - e;
      const half = 1 << (shift - 1);
      let m = mant >>> shift;
      const rest = mant & ((1 << shift) - 1);
      if (rest > half || (rest === half && (m & 1))) m++;
      out[i] = sign | m;
      continue;
    }
    let m = mant >>> 13;
    const rest = mant & 0x1fff;
    if (rest > 0x1000 || (rest === 0x1000 && (m & 1))) {
      m++;
      if (m === 0x400) {
        m = 0;
        e++;
        if (e >= 0x1f) {
          out[i] = sign | 0x7c00;
          continue;
        }
      }
    }
    out[i] = sign | (e << 10) | m;
  }
  return out;
}

/**
 * Rebuild the semantic model: see the module comment for the four edits.
 *
 * @param {Uint8Array} modelBytes the `.onnx` graph
 * @param {Uint8Array} externalData the `.data` file its initializers point into
 * @param {{ inputName?: string, classGroups?: number[][], outputName?: string, inputScale?: number }} [options]
 *   `classGroups`: append the class head (edit 5) — output channel k is the
 *   summed softmax probability of the source classes in `classGroups[k]`.
 * @returns {{ bytes: Uint8Array, stats: { resizes: number, castWeights: number, removedNodes: number } }}
 */
export function rebuildSemanticModel(modelBytes, externalData, options = {}) {
  const inputName = options.inputName ?? 'image';
  const inputScale = options.inputScale ?? 1;
  if (!(inputScale >= 1)) throw new Error(`onnx: inputScale must be ≥ 1, got ${inputScale}`);
  // What the first layer reads: the raw input, or its upsample (edit 6).
  const firstLayerInput = inputScale > 1 ? 'sv_input_scaled' : inputName;
  const outputName = options.outputName ?? 'probs';
  const classGroups = options.classGroups ?? null;
  const model = decode(modelBytes);
  const graphIndex = model.findIndex((x) => x.f === MODEL_GRAPH);
  if (graphIndex < 0) throw new Error('onnx: no graph');
  const graph = decode(/** @type {Uint8Array} */ (model[graphIndex].v));

  const nodes = graph.filter((x) => x.f === GRAPH.node).map((x) => decode(/** @type {Uint8Array} */ (x.v)));

  // 1. The normalisation prologue: Sub(image, mean) → Div(·, std).
  const sub = nodes.find((n) => nodeOp(n) === 'Sub' && nodeInputs(n)[0] === inputName);
  const div = sub && nodes.find((n) => nodeOp(n) === 'Div' && nodeInputs(n)[0] === nodeOutputs(sub)[0]);
  if (!sub || !div) throw new Error('onnx: expected a Sub → Div normalisation on the input');
  const normalised = nodeOutputs(div)[0];
  const dropConsts = new Set([nodeInputs(sub)[1], nodeInputs(div)[1]]);
  let removedNodes = 2;

  // Producer index per tensor, for the Resize reference check.
  /** @type {Map<string, number>} */
  const producer = new Map();
  nodes.forEach((n, i) => nodeOutputs(n).forEach((o) => producer.set(o, i)));

  /** @type {PbField[]} */
  const newNodes = [];
  /** @type {PbField[]} */
  const extraInitializers = [];
  if (inputScale > 1) {
    // 6. Bilinear ×inputScale on H and W, before everything else.
    extraInitializers.push(mField(GRAPH.initializer, [
      iField(TENSOR.dims, 4),
      iField(TENSOR.dataType, DT_FLOAT),
      sField(TENSOR.name, 'sv_input_scales'),
      { f: TENSOR.raw, w: 2, v: new Uint8Array(new Float32Array([1, 1, inputScale, inputScale]).buffer) },
    ]));
    newNodes.push(makeNode({
      op: 'Resize',
      name: 'sv_input_resize',
      inputs: [inputName, '', 'sv_input_scales'],
      outputs: [firstLayerInput],
      strings: { mode: 'linear', coordinate_transformation_mode: 'half_pixel' },
    }));
  }
  let resizes = 0;
  nodes.forEach((n, index) => {
    if (n === sub || n === div) return;
    const op = nodeOp(n);
    // Rewire consumers of the normalised tensor to the raw (or upsampled) input.
    let fields = n.map((x) => (x.f === NODE.input && text(x) === normalised ? sField(NODE.input, firstLayerInput) : x));
    if (op === 'Resize') {
      const ins = nodeInputs(n);
      const out = nodeOutputs(n)[0];
      const add = nodes.find((m) => nodeOp(m) === 'Add' && nodeInputs(m).includes(out));
      if (!add) throw new Error(`onnx: Resize ${out} does not feed an Add`);
      const ref = nodeInputs(add).find((t) => t !== out);
      if (!ref) throw new Error(`onnx: Add after Resize ${out} has no reference operand`);
      if ((producer.get(ref) ?? -1) >= index) throw new Error(`onnx: reference ${ref} is produced after Resize ${out}`);
      if (ins.length < 4 || !ins[3]) throw new Error(`onnx: Resize ${out} has no sizes input`);
      dropConsts.add(ins[3]);
      const tag = `sv_resize_${resizes++}`;
      newNodes.push(
        makeNode({ op: 'Shape', name: `${tag}_nc`, inputs: [ins[0]], outputs: [`${tag}_nc`], ints: { start: 0, end: 2 } }),
        makeNode({ op: 'Shape', name: `${tag}_hw`, inputs: [ref], outputs: [`${tag}_hw`], ints: { start: 2, end: 4 } }),
        makeNode({ op: 'Concat', name: `${tag}_sizes`, inputs: [`${tag}_nc`, `${tag}_hw`], outputs: [`${tag}_sizes`], ints: { axis: 0 } }),
      );
      let k = 0;
      fields = fields.map((x) => {
        if (x.f !== NODE.input) return x;
        return k++ === 3 ? sField(NODE.input, `${tag}_sizes`) : x;
      });
    }
    newNodes.push(mField(GRAPH.node, fields));
  });

  // 3. Initializers: drop the dead constants, inline + halve the weights.
  /** @type {PbField[]} */
  const initializers = [];
  /** @type {PbField[]} */
  const castNodes = [];
  let castWeights = 0;
  for (const field of graph.filter((x) => x.f === GRAPH.initializer)) {
    const tensor = decode(/** @type {Uint8Array} */ (field.v));
    const name = text(first(tensor, TENSOR.name));
    if (dropConsts.has(name)) continue;
    const dataType = Number(first(tensor, TENSOR.dataType)?.v ?? 0n);
    const external = tensor.filter((x) => x.f === TENSOR.external).map((x) => decode(/** @type {Uint8Array} */ (x.v)));
    /** @type {Uint8Array | null} */
    let raw = /** @type {Uint8Array | undefined} */ (first(tensor, TENSOR.raw)?.v) ?? null;
    if (external.length) {
      /** @type {Record<string, string>} */
      const kv = {};
      for (const e of external) kv[text(first(e, 1))] = text(first(e, 2));
      const offset = Number(kv.offset ?? 0);
      const length = Number(kv.length ?? externalData.length - offset);
      if (offset + length > externalData.length) throw new Error(`onnx: ${name} runs past the external data`);
      raw = externalData.subarray(offset, offset + length);
    }
    const dims = tensor.filter((x) => x.f === TENSOR.dims);
    const keep = tensor.filter((x) => x.f !== TENSOR.raw && x.f !== TENSOR.external && x.f !== TENSOR.location);
    if (dataType === DT_FLOAT && raw && raw.length >= 64 * 4) {
      const copy = new Uint8Array(raw);
      const halves = toFloat16Bits(new Float32Array(copy.buffer, 0, copy.length / 4));
      const halfName = `${name}__f16`;
      initializers.push(
        mField(GRAPH.initializer, [
          ...dims,
          iField(TENSOR.dataType, DT_FLOAT16),
          sField(TENSOR.name, halfName),
          { f: TENSOR.raw, w: 2, v: new Uint8Array(halves.buffer) },
        ]),
      );
      castNodes.push(makeNode({ op: 'Cast', name: `${name}__cast`, inputs: [halfName], outputs: [name], ints: { to: DT_FLOAT } }));
      castWeights++;
    } else {
      initializers.push(mField(GRAPH.initializer, raw ? [...keep, { f: TENSOR.raw, w: 2, v: raw }] : keep));
    }
  }

  initializers.push(...extraInitializers);

  // 5. The class head: Softmax → grouping 1×1 Conv → Resize to the input size.
  /** @type {PbField | null} */
  let headOutput = null;
  if (classGroups) {
    const outField = graph.find((x) => x.f === GRAPH.output);
    if (!outField) throw new Error('onnx: no graph output');
    const outVi = decode(/** @type {Uint8Array} */ (outField.v));
    const logits = text(first(outVi, 1));
    const shapeDims = decode(
      /** @type {Uint8Array} */ (first(decode(/** @type {Uint8Array} */ (first(decode(
        /** @type {Uint8Array} */ (first(outVi, 2)?.v ?? new Uint8Array()),
      ), 1)?.v ?? new Uint8Array())), 2)?.v ?? new Uint8Array()),
    ).filter((x) => x.f === 1).map((x) => decode(/** @type {Uint8Array} */ (x.v)));
    const sourceClasses = Number(first(shapeDims[1] ?? [], 1)?.v ?? 0n);
    if (!sourceClasses) throw new Error('onnx: output has no static class dimension');
    const groups = classGroups.length;
    const weight = new Float32Array(groups * sourceClasses);
    classGroups.forEach((members, g) => {
      for (const c of members) {
        if (c < 0 || c >= sourceClasses) throw new Error(`onnx: class ${c} out of range`);
        weight[g * sourceClasses + c] = 1;
      }
    });
    initializers.push(mField(GRAPH.initializer, [
      iField(TENSOR.dims, groups), iField(TENSOR.dims, sourceClasses), iField(TENSOR.dims, 1), iField(TENSOR.dims, 1),
      iField(TENSOR.dataType, DT_FLOAT),
      sField(TENSOR.name, 'sv_head_groups'),
      { f: TENSOR.raw, w: 2, v: new Uint8Array(weight.buffer) },
    ]));
    newNodes.push(
      makeNode({ op: 'Softmax', name: 'sv_head_softmax', inputs: [logits], outputs: ['sv_head_softmax'], ints: { axis: 1 } }),
      makeNode({ op: 'Conv', name: 'sv_head_group', inputs: ['sv_head_softmax', 'sv_head_groups'], outputs: ['sv_head_low'] }),
      makeNode({ op: 'Shape', name: 'sv_head_nc', inputs: ['sv_head_low'], outputs: ['sv_head_nc'], ints: { start: 0, end: 2 } }),
      makeNode({ op: 'Shape', name: 'sv_head_hw', inputs: [inputName], outputs: ['sv_head_hw'], ints: { start: 2, end: 4 } }),
      makeNode({ op: 'Concat', name: 'sv_head_sizes', inputs: ['sv_head_nc', 'sv_head_hw'], outputs: ['sv_head_sizes'], ints: { axis: 0 } }),
      makeNode({
        op: 'Resize',
        name: 'sv_head_resize',
        inputs: ['sv_head_low', '', '', 'sv_head_sizes'],
        outputs: [outputName],
        strings: { mode: 'linear', coordinate_transformation_mode: 'half_pixel' },
      }),
    );
    /** @param {number | string} d */
    const dim = (d) => mField(1, [typeof d === 'number' ? iField(1, d) : sField(2, d)]);
    headOutput = mField(GRAPH.output, [
      sField(1, outputName),
      mField(2, [mField(1, [iField(1, DT_FLOAT), mField(2, [dim(1), dim(groups), dim('height'), dim('width')])])]),
    ]);
  }

  // 2. Symbolic height/width on the graph input and output.
  /** @param {PbField} field @param {string[]} names */
  const symbolic = (field, names) => {
    const vi = decode(/** @type {Uint8Array} */ (field.v));
    const type = decode(/** @type {Uint8Array} */ (first(vi, 2)?.v ?? new Uint8Array()));
    const tensorType = decode(/** @type {Uint8Array} */ (first(type, 1)?.v ?? new Uint8Array()));
    const shape = decode(/** @type {Uint8Array} */ (first(tensorType, 2)?.v ?? new Uint8Array()));
    let d = 0;
    const dims = shape.map((x) => {
      if (x.f !== 1) return x;
      const i = d++;
      return i >= 2 ? mField(1, [sField(2, names[i - 2])]) : x;
    });
    const newTensorType = tensorType.map((x) => (x.f === 2 ? mField(2, dims) : x));
    const newType = type.map((x) => (x.f === 1 ? mField(1, newTensorType) : x));
    return mField(field.f, vi.map((x) => (x.f === 2 ? mField(2, newType) : x)));
  };

  /** @type {PbField[]} */
  const outGraph = [];
  let nodesEmitted = false;
  let initEmitted = false;
  for (const field of graph) {
    if (field.f === GRAPH.node) {
      if (!nodesEmitted) {
        outGraph.push(...castNodes, ...newNodes);
        nodesEmitted = true;
      }
    } else if (field.f === GRAPH.initializer) {
      if (!initEmitted) {
        outGraph.push(...initializers);
        initEmitted = true;
      }
    } else if (field.f === GRAPH.input) {
      outGraph.push(symbolic(field, ['height', 'width']));
    } else if (field.f === GRAPH.output) {
      outGraph.push(headOutput ?? symbolic(field, ['out_height', 'out_width']));
    } else if (field.f !== GRAPH.valueInfo) {
      outGraph.push(field);
    }
  }
  const outModel = model.map((x, i) => (i === graphIndex ? mField(MODEL_GRAPH, outGraph) : x));
  return { bytes: encode(outModel), stats: { resizes, castWeights, removedNodes } };
}
