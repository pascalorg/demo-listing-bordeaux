# PERF1 result

`?dpr=N` now replaces the normal desktop/mobile DPR cap, clamps to `0.75–2`, and remains bounded by the current device DPR on every runtime DPR check. With no valid value, the existing 1.5 desktop / 1.25 coarse-pointer behavior is unchanged.

For the WebGPU real look, `?gi=high` keeps the existing SSGI settings (2 slices × 8 steps, radius 12), `med` uses 1 × 8 at radius 12, and `low` uses 1 × 4 at radius 7. All tiers retain the existing TRAA, recurrent denoise, and 32-frame convergence settings. The parameter has no effect on sketch or WebGL2.

## Evidence

- Build: `bun run build` — passed (`40 modules transformed`, `✓ built in 1.03s`; only Vite's existing chunk-size advisory).
- Settled séjour at recording DPR 1: [`gi=high`](scratchpad/verify/perf1-sejour-gi-high.png) and [`gi=med`](scratchpad/verify/perf1-sejour-gi-med.png). Visual inspection is near-identical; the full-stage comparison measured 6.66/255 mean channel error and 29.13 dB PSNR.
- Retina DPR proof at CSS `1425 × 844`, device DPR 2: default renderer DPR `1.5`, drawing buffer `2137 × 1266`; `?dpr=1`: renderer DPR `1`, drawing buffer `1425 × 844`.
- Convergence/idle: both real tiers reached `remaining=0`; over the following 900 ms render counts stayed `110 → 110` (high) and `107 → 107` (med), with zero console/page errors.
- Forced WebGL2 with `?gi=low` still reported `backend=webgl2`, `look=direct`, `remaining=0`, with zero console/page errors.
