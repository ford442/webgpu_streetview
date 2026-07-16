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
;;   normalize_angle(a: f32)                          → f32  [0, 360)
;;   signed_angle_diff(from: f32, to: f32)            → f32  (-180, 180]
;;   haversine(lat1: f64, lon1: f64,
;;             lat2: f64, lon2: f64)                  → f64  metres
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

  ;; ---- haversine(lat1, lon1, lat2, lon2) → f64 metres (exported) ----
  ;; Great-circle distance via the haversine formula, using the host sin/cos/
  ;; atan2 imports above for exact double-precision transcendentals.
  (func (export "haversine")
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
)
