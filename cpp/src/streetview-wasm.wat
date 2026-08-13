;; streetview-wasm.wat
;; WebAssembly Text source for the WebGPU StreetView noise/utility module.
;;
;; This file is the canonical WAT source that generates the pre-built
;; public/wasm/streetview-wasm.wasm binary (via scripts/build-wasm.sh).
;;
;; The equivalent C++ implementation lives in cpp/src/noise_module.cpp
;; and produces a more complete module (including haversine via libm)
;; when compiled with Emscripten.
;;
;; Exported functions:
;;   seed(s: i32)                                    → void
;;   noise2d(x: f32, y: f32)                         → f32  [-1, 1]
;;   fill_noise_buffer(ptr: i32, w: i32, h: i32,
;;                     scale: f32, ox: f32, oy: f32)  → void
;;   fbm2d(x: f32, y: f32, octaves: i32,
;;         lacunarity: f32, gain: f32)                → f32  [-1, 1]
;;   fill_fbm_buffer(ptr: i32, w: i32, h: i32,
;;                   scale: f32, ox: f32, oy: f32,
;;                   octaves: i32, lacunarity: f32,
;;                   gain: f32)                       → void
;;   fill_particle_seeds(ptr: i32, count: i32,
;;                       seed: i32)                   → void
;;   normalize_angle(a: f32)                          → f32  [0, 360)
;;   signed_angle_diff(from: f32, to: f32)            → f32  (-180, 180]
;;   haversine(lat1: f64, lon1: f64,
;;             lat2: f64, lon2: f64)                  → f64  metres
;;   batch_haversine(ptr: i32, count: i32,
;;                   out: i32)                        → f64  total metres
;;   fill_engine_noise(ptr, count, rpm, load, speed,
;;                     time, sampleRate)               → void  mono f32 PCM
;;
;; haversine relies on "env.sin"/"env.cos"/"env.atan2" host imports (WASM has
;; no built-in transcendental functions) — the TypeScript wrapper
;; (src/wasm/index.ts) supplies Math.sin/Math.cos/Math.atan2 at instantiation
;; time, so the result matches the JS fallback formula bit-for-bit.

(module
  ;; ---- Host-provided math imports (f64, exact precision) ----
  (import "env" "sin" (func $env_sin (param f64) (result f64)))
  (import "env" "cos" (func $env_cos (param f64) (result f64)))
  (import "env" "atan2" (func $env_atan2 (param f64) (param f64) (result f64)))

  ;; Memory layout:
  ;;   [0 .. 511]   perm[512] – u8 permutation table (identity default)
  ;; 1 page = 64 KiB.
  (memory (export "memory") 1)

  ;; Default identity permutation (0..255, duplicated).
  (data (i32.const 0)
    "\00\01\02\03\04\05\06\07\08\09\0a\0b\0c\0d\0e\0f"
    "\10\11\12\13\14\15\16\17\18\19\1a\1b\1c\1d\1e\1f"
    "\20\21\22\23\24\25\26\27\28\29\2a\2b\2c\2d\2e\2f"
    "\30\31\32\33\34\35\36\37\38\39\3a\3b\3c\3d\3e\3f"
    "\40\41\42\43\44\45\46\47\48\49\4a\4b\4c\4d\4e\4f"
    "\50\51\52\53\54\55\56\57\58\59\5a\5b\5c\5d\5e\5f"
    "\60\61\62\63\64\65\66\67\68\69\6a\6b\6c\6d\6e\6f"
    "\70\71\72\73\74\75\76\77\78\79\7a\7b\7c\7d\7e\7f"
    "\80\81\82\83\84\85\86\87\88\89\8a\8b\8c\8d\8e\8f"
    "\90\91\92\93\94\95\96\97\98\99\9a\9b\9c\9d\9e\9f"
    "\a0\a1\a2\a3\a4\a5\a6\a7\a8\a9\aa\ab\ac\ad\ae\af"
    "\b0\b1\b2\b3\b4\b5\b6\b7\b8\b9\ba\bb\bc\bd\be\bf"
    "\c0\c1\c2\c3\c4\c5\c6\c7\c8\c9\ca\cb\cc\cd\ce\cf"
    "\d0\d1\d2\d3\d4\d5\d6\d7\d8\d9\da\db\dc\dd\de\df"
    "\e0\e1\e2\e3\e4\e5\e6\e7\e8\e9\ea\eb\ec\ed\ee\ef"
    "\f0\f1\f2\f3\f4\f5\f6\f7\f8\f9\fa\fb\fc\fd\fe\ff"
    "\00\01\02\03\04\05\06\07\08\09\0a\0b\0c\0d\0e\0f"
    "\10\11\12\13\14\15\16\17\18\19\1a\1b\1c\1d\1e\1f"
    "\20\21\22\23\24\25\26\27\28\29\2a\2b\2c\2d\2e\2f"
    "\30\31\32\33\34\35\36\37\38\39\3a\3b\3c\3d\3e\3f"
    "\40\41\42\43\44\45\46\47\48\49\4a\4b\4c\4d\4e\4f"
    "\50\51\52\53\54\55\56\57\58\59\5a\5b\5c\5d\5e\5f"
    "\60\61\62\63\64\65\66\67\68\69\6a\6b\6c\6d\6e\6f"
    "\70\71\72\73\74\75\76\77\78\79\7a\7b\7c\7d\7e\7f"
    "\80\81\82\83\84\85\86\87\88\89\8a\8b\8c\8d\8e\8f"
    "\90\91\92\93\94\95\96\97\98\99\9a\9b\9c\9d\9e\9f"
    "\a0\a1\a2\a3\a4\a5\a6\a7\a8\a9\aa\ab\ac\ad\ae\af"
    "\b0\b1\b2\b3\b4\b5\b6\b7\b8\b9\ba\bb\bc\bd\be\bf"
    "\c0\c1\c2\c3\c4\c5\c6\c7\c8\c9\ca\cb\cc\cd\ce\cf"
    "\d0\d1\d2\d3\d4\d5\d6\d7\d8\d9\da\db\dc\dd\de\df"
    "\e0\e1\e2\e3\e4\e5\e6\e7\e8\e9\ea\eb\ec\ed\ee\ef"
    "\f0\f1\f2\f3\f4\f5\f6\f7\f8\f9\fa\fb\fc\fd\fe\ff"
  )

  ;; ---- Internal: Perlin improved fade: 6t^5 - 15t^4 + 10t^3 ----
  (func $fade (param $t f32) (result f32)
    (f32.mul
      (f32.mul (local.get $t) (f32.mul (local.get $t) (local.get $t)))
      (f32.add
        (f32.mul
          (local.get $t)
          (f32.sub (f32.mul (local.get $t) (f32.const 6.0)) (f32.const 15.0)))
        (f32.const 10.0)))
  )

  ;; ---- Internal: lerp ----
  (func $lerp (param $a f32) (param $b f32) (param $t f32) (result f32)
    (f32.add
      (local.get $a)
      (f32.mul (local.get $t) (f32.sub (local.get $b) (local.get $a))))
  )

  ;; ---- Internal: 2-D gradient dot product (8-direction table) ----
  (func $grad2d (param $h i32) (param $dx f32) (param $dy f32) (result f32)
    (local $gi i32)
    (local.set $gi (i32.and (local.get $h) (i32.const 7)))
    (block $blk
      (block $c7
        (block $c6
          (block $c5
            (block $c4
              (block $c3
                (block $c2
                  (block $c1
                    (block $c0
                      (br_table $c0 $c1 $c2 $c3 $c4 $c5 $c6 $c7 $c0
                        (local.get $gi))
                    )
                    (return (local.get $dx))
                  )
                  (return (f32.neg (local.get $dx)))
                )
                (return (local.get $dy))
              )
              (return (f32.neg (local.get $dy)))
            )
            (return (f32.add
              (f32.mul (local.get $dx) (f32.const 0.70710678))
              (f32.mul (local.get $dy) (f32.const 0.70710678))))
          )
          (return (f32.add
            (f32.mul (local.get $dx) (f32.const -0.70710678))
            (f32.mul (local.get $dy) (f32.const  0.70710678))))
        )
        (return (f32.add
          (f32.mul (local.get $dx) (f32.const  0.70710678))
          (f32.mul (local.get $dy) (f32.const -0.70710678))))
      )
      (return (f32.add
        (f32.mul (local.get $dx) (f32.const -0.70710678))
        (f32.mul (local.get $dy) (f32.const -0.70710678))))
    )
    (f32.const 0.0)
  )

  ;; ---- seed(s: i32) → void ----
  ;; LCG-based Fisher-Yates shuffle; duplicates result into perm[256..511].
  (func (export "seed") (param $s i32)
    (local $state i32)
    (local $i i32)
    (local $j i32)
    (local $tmp i32)

    ;; Restore identity.
    (local.set $i (i32.const 0))
    (block $ib
      (loop $il
        (br_if $ib (i32.ge_u (local.get $i) (i32.const 256)))
        (i32.store8 (local.get $i) (local.get $i))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $il)))

    ;; Fisher-Yates shuffle.
    (local.set $state (local.get $s))
    (local.set $i (i32.const 255))
    (block $fb
      (loop $fl
        (br_if $fb (i32.le_s (local.get $i) (i32.const 0)))
        (local.set $state
          (i32.add (i32.mul (local.get $state) (i32.const 1664525)) (i32.const 1013904223)))
        (local.set $j
          (i32.rem_u
            (i32.and (i32.shr_u (local.get $state) (i32.const 16)) (i32.const 32767))
            (i32.add (local.get $i) (i32.const 1))))
        (local.set $tmp (i32.load8_u (local.get $i)))
        (i32.store8 (local.get $i) (i32.load8_u (local.get $j)))
        (i32.store8 (local.get $j) (local.get $tmp))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (br $fl)))

    ;; Duplicate into [256..511].
    (local.set $i (i32.const 0))
    (block $db
      (loop $dl
        (br_if $db (i32.ge_u (local.get $i) (i32.const 256)))
        (i32.store8
          (i32.add (local.get $i) (i32.const 256))
          (i32.load8_u (local.get $i)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $dl)))
  )

  ;; ---- Internal noise2d implementation (callable from fill_noise_buffer) ----
  (func $noise2d_internal (param $x f32) (param $y f32) (result f32)
    (local $ix i32) (local $iy i32)
    (local $fx f32) (local $fy f32)
    (local $u f32)  (local $v f32)
    (local $X i32)  (local $Y i32)
    (local $pX i32) (local $pX1 i32)
    (local $n00 f32) (local $n10 f32) (local $n01 f32) (local $n11 f32)

    (local.set $ix (i32.trunc_f32_s (f32.floor (local.get $x))))
    (local.set $iy (i32.trunc_f32_s (f32.floor (local.get $y))))
    (local.set $fx (f32.sub (local.get $x) (f32.convert_i32_s (local.get $ix))))
    (local.set $fy (f32.sub (local.get $y) (f32.convert_i32_s (local.get $iy))))
    (local.set $u (call $fade (local.get $fx)))
    (local.set $v (call $fade (local.get $fy)))
    (local.set $X (i32.and (local.get $ix) (i32.const 255)))
    (local.set $Y (i32.and (local.get $iy) (i32.const 255)))
    (local.set $pX  (i32.load8_u (local.get $X)))
    (local.set $pX1 (i32.load8_u (i32.add (local.get $X) (i32.const 1))))

    (local.set $n00
      (call $grad2d
        (i32.load8_u (i32.add (local.get $pX) (local.get $Y)))
        (local.get $fx) (local.get $fy)))
    (local.set $n10
      (call $grad2d
        (i32.load8_u (i32.add (local.get $pX1) (local.get $Y)))
        (f32.sub (local.get $fx) (f32.const 1.0)) (local.get $fy)))
    (local.set $n01
      (call $grad2d
        (i32.load8_u (i32.add (local.get $pX) (i32.add (local.get $Y) (i32.const 1))))
        (local.get $fx) (f32.sub (local.get $fy) (f32.const 1.0))))
    (local.set $n11
      (call $grad2d
        (i32.load8_u (i32.add (local.get $pX1) (i32.add (local.get $Y) (i32.const 1))))
        (f32.sub (local.get $fx) (f32.const 1.0))
        (f32.sub (local.get $fy) (f32.const 1.0))))

    (call $lerp
      (call $lerp (local.get $n00) (local.get $n10) (local.get $u))
      (call $lerp (local.get $n01) (local.get $n11) (local.get $u))
      (local.get $v))
  )

  ;; ---- noise2d(x: f32, y: f32) → f32  [-1, 1]  (exported) ----
  (func (export "noise2d") (param $x f32) (param $y f32) (result f32)
    (call $noise2d_internal (local.get $x) (local.get $y))
  )

  ;; ---- fill_noise_buffer(ptr, w, h, scale, ox, oy) → void ----
  (func (export "fill_noise_buffer")
    (param $ptr i32) (param $w i32) (param $h i32)
    (param $scale f32) (param $ox f32) (param $oy f32)
    (local $row i32) (local $col i32)
    (local $nx f32)  (local $ny f32)
    (local $inv_scale f32)
    (local $wp i32)

    (local.set $inv_scale (f32.div (f32.const 1.0) (local.get $scale)))
    (local.set $wp (local.get $ptr))

    (local.set $row (i32.const 0))
    (block $rb
      (loop $rl
        (br_if $rb (i32.ge_s (local.get $row) (local.get $h)))
        (local.set $col (i32.const 0))
        (block $cb
          (loop $cl
            (br_if $cb (i32.ge_s (local.get $col) (local.get $w)))
            (local.set $nx
              (f32.mul
                (f32.add (f32.convert_i32_s (local.get $col)) (local.get $ox))
                (local.get $inv_scale)))
            (local.set $ny
              (f32.mul
                (f32.add (f32.convert_i32_s (local.get $row)) (local.get $oy))
                (local.get $inv_scale)))
            (f32.store
              (local.get $wp)
              (call $noise2d_internal (local.get $nx) (local.get $ny)))
            (local.set $wp (i32.add (local.get $wp) (i32.const 4)))
            (local.set $col (i32.add (local.get $col) (i32.const 1)))
            (br $cl)))
        (local.set $row (i32.add (local.get $row) (i32.const 1)))
        (br $rl)))
  )

  ;; ---- Internal: fractal Brownian motion over $noise2d_internal ----
  ;; Sums `octaves` octaves, each `lacunarity`x the previous frequency and
  ;; `gain`x the previous amplitude, then divides by the accumulated amplitude
  ;; so the result stays in [-1, 1] regardless of octave count.
  (func $fbm2d_internal
    (param $x f32) (param $y f32)
    (param $octaves i32) (param $lacunarity f32) (param $gain f32)
    (result f32)
    (local $sum f32) (local $norm f32)
    (local $amp f32) (local $freq f32) (local $o i32)

    (local.set $sum  (f32.const 0.0))
    (local.set $norm (f32.const 0.0))
    (local.set $amp  (f32.const 1.0))
    (local.set $freq (f32.const 1.0))
    (local.set $o    (i32.const 0))

    (block $ob
      (loop $ol
        (br_if $ob (i32.ge_s (local.get $o) (local.get $octaves)))
        (local.set $sum
          (f32.add
            (local.get $sum)
            (f32.mul
              (local.get $amp)
              (call $noise2d_internal
                (f32.mul (local.get $x) (local.get $freq))
                (f32.mul (local.get $y) (local.get $freq))))))
        (local.set $norm (f32.add (local.get $norm) (local.get $amp)))
        (local.set $amp  (f32.mul (local.get $amp)  (local.get $gain)))
        (local.set $freq (f32.mul (local.get $freq) (local.get $lacunarity)))
        (local.set $o    (i32.add (local.get $o)    (i32.const 1)))
        (br $ol)))

    (if (result f32) (f32.gt (local.get $norm) (f32.const 0.0))
      (then (f32.div (local.get $sum) (local.get $norm)))
      (else (f32.const 0.0)))
  )

  ;; ---- fbm2d(x, y, octaves, lacunarity, gain) → f32  [-1, 1] ----
  (func (export "fbm2d")
    (param $x f32) (param $y f32)
    (param $octaves i32) (param $lacunarity f32) (param $gain f32)
    (result f32)
    (call $fbm2d_internal
      (local.get $x) (local.get $y)
      (local.get $octaves) (local.get $lacunarity) (local.get $gain))
  )

  ;; ---- fill_fbm_buffer(ptr, w, h, scale, ox, oy, octaves, lacunarity, gain) ----
  ;; Same tile layout as fill_noise_buffer, but every sample is an fBm stack —
  ;; used for the richer dust turbulence tile on the compute weather path.
  (func (export "fill_fbm_buffer")
    (param $ptr i32) (param $w i32) (param $h i32)
    (param $scale f32) (param $ox f32) (param $oy f32)
    (param $octaves i32) (param $lacunarity f32) (param $gain f32)
    (local $row i32) (local $col i32)
    (local $nx f32)  (local $ny f32)
    (local $inv_scale f32)
    (local $wp i32)

    (local.set $inv_scale (f32.div (f32.const 1.0) (local.get $scale)))
    (local.set $wp (local.get $ptr))

    (local.set $row (i32.const 0))
    (block $rb
      (loop $rl
        (br_if $rb (i32.ge_s (local.get $row) (local.get $h)))
        (local.set $col (i32.const 0))
        (block $cb
          (loop $cl
            (br_if $cb (i32.ge_s (local.get $col) (local.get $w)))
            (local.set $nx
              (f32.mul
                (f32.add (f32.convert_i32_s (local.get $col)) (local.get $ox))
                (local.get $inv_scale)))
            (local.set $ny
              (f32.mul
                (f32.add (f32.convert_i32_s (local.get $row)) (local.get $oy))
                (local.get $inv_scale)))
            (f32.store
              (local.get $wp)
              (call $fbm2d_internal
                (local.get $nx) (local.get $ny)
                (local.get $octaves) (local.get $lacunarity) (local.get $gain)))
            (local.set $wp (i32.add (local.get $wp) (i32.const 4)))
            (local.set $col (i32.add (local.get $col) (i32.const 1)))
            (br $cl)))
        (local.set $row (i32.add (local.get $row) (i32.const 1)))
        (br $rl)))
  )

  ;; ---- Internal: LCG step (same constants as $seed's shuffle) ----
  (func $lcg_next (param $s i32) (result i32)
    (i32.add (i32.mul (local.get $s) (i32.const 1664525)) (i32.const 1013904223))
  )

  ;; ---- Internal: LCG state → f32 in [0, 1) (top 24 bits of the low word) ----
  (func $lcg_unit (param $s i32) (result f32)
    (f32.div
      (f32.convert_i32_u
        (i32.and (i32.shr_u (local.get $s) (i32.const 8)) (i32.const 0xffffff)))
      (f32.const 16777216.0))
  )

  ;; ---- fill_particle_seeds(ptr, count, seed) → void ----
  ;; Writes 4 floats per particle: x [0,1), y [0,1), speed [0.5,1.5),
  ;; phase [0, 2π).  Deterministic for a given seed so GPU particle systems can
  ;; be replayed frame-for-frame.
  (func (export "fill_particle_seeds")
    (param $ptr i32) (param $count i32) (param $seed i32)
    (local $i i32) (local $state i32) (local $wp i32)

    (local.set $state (local.get $seed))
    (local.set $wp (local.get $ptr))
    (local.set $i (i32.const 0))

    (block $b
      (loop $l
        (br_if $b (i32.ge_s (local.get $i) (local.get $count)))

        ;; x
        (local.set $state (call $lcg_next (local.get $state)))
        (f32.store (local.get $wp) (call $lcg_unit (local.get $state)))
        ;; y
        (local.set $state (call $lcg_next (local.get $state)))
        (f32.store offset=4 (local.get $wp) (call $lcg_unit (local.get $state)))
        ;; speed = 0.5 + unit
        (local.set $state (call $lcg_next (local.get $state)))
        (f32.store offset=8
          (local.get $wp)
          (f32.add (f32.const 0.5) (call $lcg_unit (local.get $state))))
        ;; phase = unit * 2π
        (local.set $state (call $lcg_next (local.get $state)))
        (f32.store offset=12
          (local.get $wp)
          (f32.mul (call $lcg_unit (local.get $state)) (f32.const 6.2831853)))

        (local.set $wp (i32.add (local.get $wp) (i32.const 16)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
  )

  ;; ---- fill_engine_noise(ptr, count, rpm, load, speed, time, sr) → void ----
  ;; Writes `count` mono f32 PCM samples in [-1, 1]. Saw-stack engine tone
  ;; plus LCG road noise; bit-identical to C++ / JS fallback (f32 math).
  (func (export "fill_engine_noise")
    (param $ptr i32) (param $count i32)
    (param $rpm f32) (param $load f32) (param $speed f32)
    (param $time f32) (param $sr f32)
    (local $i i32) (local $wp i32) (local $state i32)
    (local $inv_sr f32) (local $fund f32) (local $spd f32)
    (local $t f32) (local $cycles f32) (local $frac f32)
    (local $saw f32) (local $cycles2 f32) (local $frac2 f32)
    (local $saw2 f32) (local $eng f32) (local $n f32) (local $s f32)

    (if (f32.le (local.get $sr) (f32.const 1.0))
      (then (local.set $sr (f32.const 44100.0))))
    (if (f32.lt (local.get $rpm) (f32.const 0.0))
      (then (local.set $rpm (f32.const 0.0))))
    (if (f32.lt (local.get $load) (f32.const 0.0))
      (then (local.set $load (f32.const 0.0))))
    (if (f32.gt (local.get $load) (f32.const 1.0))
      (then (local.set $load (f32.const 1.0))))
    (if (f32.lt (local.get $speed) (f32.const 0.0))
      (then (local.set $speed (f32.const 0.0))))
    (if (f32.lt (local.get $time) (f32.const 0.0))
      (then (local.set $time (f32.const 0.0))))

    (local.set $inv_sr (f32.div (f32.const 1.0) (local.get $sr)))
    (local.set $fund (f32.div (local.get $rpm) (f32.const 60.0)))
    (local.set $state
      (i32.trunc_sat_f32_u (f32.floor (f32.mul (local.get $time) (local.get $sr)))))
    (if (i32.eqz (local.get $state))
      (then (local.set $state (i32.const 1))))
    (local.set $spd (f32.div (local.get $speed) (f32.const 140.0)))
    (if (f32.gt (local.get $spd) (f32.const 1.0))
      (then (local.set $spd (f32.const 1.0))))

    (local.set $wp (local.get $ptr))
    (local.set $i (i32.const 0))
    (block $b
      (loop $l
        (br_if $b (i32.ge_s (local.get $i) (local.get $count)))
        (local.set $t
          (f32.add (local.get $time)
            (f32.mul (f32.convert_i32_s (local.get $i)) (local.get $inv_sr))))
        (local.set $cycles (f32.mul (local.get $t) (local.get $fund)))
        (local.set $frac (f32.sub (local.get $cycles) (f32.floor (local.get $cycles))))
        (local.set $saw (f32.sub (f32.mul (local.get $frac) (f32.const 2.0)) (f32.const 1.0)))
        (local.set $cycles2
          (f32.mul (local.get $t) (f32.mul (local.get $fund) (f32.const 2.0))))
        (local.set $frac2 (f32.sub (local.get $cycles2) (f32.floor (local.get $cycles2))))
        (local.set $saw2 (f32.sub (f32.mul (local.get $frac2) (f32.const 2.0)) (f32.const 1.0)))
        (local.set $eng
          (f32.mul
            (f32.add
              (f32.mul (local.get $saw) (f32.const 0.28))
              (f32.mul (local.get $saw2) (f32.const 0.11)))
            (f32.add (f32.const 0.22) (f32.mul (f32.const 0.78) (local.get $load)))))
        (local.set $state (call $lcg_next (local.get $state)))
        (local.set $n
          (f32.sub (f32.mul (call $lcg_unit (local.get $state)) (f32.const 2.0)) (f32.const 1.0)))
        (local.set $s
          (f32.add (local.get $eng)
            (f32.mul (f32.mul (local.get $n) (local.get $spd)) (f32.const 0.18))))
        (if (f32.gt (local.get $s) (f32.const 1.0))
          (then (local.set $s (f32.const 1.0))))
        (if (f32.lt (local.get $s) (f32.const -1.0))
          (then (local.set $s (f32.const -1.0))))
        (f32.store (local.get $wp) (local.get $s))
        (local.set $wp (i32.add (local.get $wp) (i32.const 4)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
  )

  ;; ---- normalize_angle(a: f32) → f32  [0, 360) ----
  (func (export "normalize_angle") (param $a f32) (result f32)
    (f32.sub
      (local.get $a)
      (f32.mul
        (f32.const 360.0)
        (f32.floor (f32.div (local.get $a) (f32.const 360.0)))))
  )

  ;; ---- signed_angle_diff(from: f32, to: f32) → f32  (-180, 180] ----
  (func (export "signed_angle_diff") (param $from f32) (param $to f32) (result f32)
    (local $d f32)
    (local.set $d (f32.sub (local.get $to) (local.get $from)))
    (f32.sub
      (local.get $d)
      (f32.mul
        (f32.const 360.0)
        (f32.floor
          (f32.div (f32.add (local.get $d) (f32.const 180.0)) (f32.const 360.0)))))
  )

  ;; ---- Internal haversine (shared by the scalar and batch exports) ----
  ;; Great-circle distance via the haversine formula, using the host sin/cos/
  ;; atan2 imports above for exact double-precision transcendentals.
  (func $haversine_internal
    (param $lat1 f64) (param $lon1 f64) (param $lat2 f64) (param $lon2 f64) (result f64)
    (local $deg2rad f64)
    (local $lat1r f64) (local $lat2r f64)
    (local $dLatHalf f64) (local $dLonHalf f64)
    (local $sinDLatHalf f64) (local $sinDLonHalf f64)
    (local $cosLat1 f64) (local $cosLat2 f64)
    (local $a f64) (local $y f64) (local $x f64)

    (local.set $deg2rad (f64.const 0.017453292519943295))
    (local.set $lat1r (f64.mul (local.get $lat1) (local.get $deg2rad)))
    (local.set $lat2r (f64.mul (local.get $lat2) (local.get $deg2rad)))
    (local.set $dLatHalf
      (f64.mul (f64.const 0.5)
        (f64.mul (f64.sub (local.get $lat2) (local.get $lat1)) (local.get $deg2rad))))
    (local.set $dLonHalf
      (f64.mul (f64.const 0.5)
        (f64.mul (f64.sub (local.get $lon2) (local.get $lon1)) (local.get $deg2rad))))

    (local.set $sinDLatHalf (call $env_sin (local.get $dLatHalf)))
    (local.set $sinDLonHalf (call $env_sin (local.get $dLonHalf)))
    (local.set $cosLat1 (call $env_cos (local.get $lat1r)))
    (local.set $cosLat2 (call $env_cos (local.get $lat2r)))

    (local.set $a
      (f64.add
        (f64.mul (local.get $sinDLatHalf) (local.get $sinDLatHalf))
        (f64.mul
          (f64.mul (local.get $cosLat1) (local.get $cosLat2))
          (f64.mul (local.get $sinDLonHalf) (local.get $sinDLonHalf)))))
    ;; Clamp for float round-off (a can drift a hair outside [0,1]).
    (local.set $a (f64.min (f64.max (local.get $a) (f64.const 0.0)) (f64.const 1.0)))

    (local.set $y (f64.sqrt (local.get $a)))
    (local.set $x (f64.sqrt (f64.sub (f64.const 1.0) (local.get $a))))

    (f64.mul
      (f64.const 6371000.0)
      (f64.mul (f64.const 2.0) (call $env_atan2 (local.get $y) (local.get $x))))
  )

  ;; ---- haversine(lat1, lon1, lat2, lon2) → f64 metres ----
  (func (export "haversine")
    (param $lat1 f64) (param $lon1 f64) (param $lat2 f64) (param $lon2 f64) (result f64)
    (call $haversine_internal
      (local.get $lat1) (local.get $lon1) (local.get $lat2) (local.get $lon2))
  )

  ;; ---- batch_haversine(ptr, count, out) → f64 total metres ----
  ;; `ptr` points at `count` consecutive f64 [lat, lon] pairs (16 bytes each).
  ;; Writes the `count - 1` consecutive segment distances (f64 metres) to `out`
  ;; and returns their sum, so a whole polyline costs one call instead of one
  ;; boundary crossing per segment.  Both pointers must be 8-byte aligned.
  (func (export "batch_haversine")
    (param $ptr i32) (param $count i32) (param $out i32) (result f64)
    (local $i i32) (local $p i32) (local $total f64) (local $d f64)

    (local.set $total (f64.const 0.0))
    (local.set $i (i32.const 0))
    (block $b
      (loop $l
        (br_if $b
          (i32.ge_s (local.get $i) (i32.sub (local.get $count) (i32.const 1))))
        (local.set $p
          (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 16))))
        (local.set $d
          (call $haversine_internal
            (f64.load          (local.get $p))
            (f64.load offset=8  (local.get $p))
            (f64.load offset=16 (local.get $p))
            (f64.load offset=24 (local.get $p))))
        (f64.store
          (i32.add (local.get $out) (i32.mul (local.get $i) (i32.const 8)))
          (local.get $d))
        (local.set $total (f64.add (local.get $total) (local.get $d)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))

    (local.get $total)
  )
)
