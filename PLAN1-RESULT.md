# PLAN1 result — GLB upgrade and plan interaction

## Result

`public/assets/model/apartment.glb` is now the user-supplied `lod0 (11).glb` (`5,072,544 bytes`, SHA-256 `e0cd8c4b19060ea7091a9b35735bbd0eed4dc459cefab58226a02ae037162a5d`). The new asset loads with the existing zones, labels, plan mapping, photo cameras, opening scrubs, and walkthrough door interactions intact. No node or clip reference needed remapping.

| Check | Before → `lod0 (11)` | Diff / resolution |
|---|---:|---|
| GLB nodes | `1,336 → 1,336` | Same complete name/`pascalId` identity set; `0` added, `0` removed. |
| Animation clips | `30 → 30` | Same complete name set; `0` added, `0` removed. `window_cheeuc6e0qbb0e44: open` moved from slot 30 to slot 4 only. |
| Required openings | `12 doors + authored Chambre 1 window → same` | Every walkthrough door has its node and `: open` clip; `door_cvdmtaj49xgwpnfh`, `door_2udbl7hf9ws2cdnr`, and `window_cheeuc6e0qbb0e44` all resolve. |
| Zone metadata | `9 → 9` | All Pascal ids, labels, polygons, colors, and other zone extras are byte-equivalent in the GLB JSON. |

The new clip count is **30**.

## Feature hooks

- GLB upgrade — the existing opening controllers continue resolving Pascal ids and exact `: open` clip names; no fallback/remap path is active.
- Plan entry/return — the `plan` story beat is the explicit captured pose `[-8.69, 30.18, 1.99] → [-8.69, 25.18, 1.94]`, FOV `30.01`; room return and re-entry restore it exactly.
- Plan and room orbit — the shared plan override initializes only on pointer-down, derives a collinear floor-height pivot for the captured top-down pose, and reinitializes from the settled room fly-to target after a focus flight.
- Reverse hover/click — plan-only pointer events raycast to the zone floor polygons; the result drives the existing 3D highlight plus `.is-model-hovered` on the matching SVG room, while a non-drag pointer-up calls the same room fly-to path as a plan click.

## Lean evidence

- `bun run build` — passed.
- New GLB, séjour beat: `scratchpad/verify/plan1-new-glb-sejour.png`; French door was fully open at clip time `1.0`.
- New GLB, suite/Chambre 1 beat: `scratchpad/verify/plan1-new-glb-suite.png`; authored window was fully open at clip time `1.0` and the photo camera remained `[-6.17, 0.88, 7.30] → [-1.53, 0.70, 5.44]`, FOV `70.24`.
- New GLB, French door part-open: `scratchpad/verify/plan1-new-glb-french-door-mid.png`; story `floor → sejour t=0.76`, paused clip progress/time `0.5 / 0.5 s`.
- Exact plan entry: `scratchpad/verify/plan1-plan-entry-exact.png`; measured pose exactly matched the requested eye, target, and FOV.
- Focused room orbited away: `scratchpad/verify/plan1-room-focus-orbited.png`; séjour moved from fly pose `[-8.82, 1.80, -0.94]` to `[-9.40, 3.42, -2.85]` around the unchanged room target.
- Bidirectional hover: `scratchpad/verify/plan1-3d-hover-bidirectional.png`; Séjour had 3D zone target/current `1 / 1` and its 2D SVG room had the model-hover state simultaneously.
- Machine report: `scratchpad/verify/plan1-report.json`; all 12 walkthrough door node/clip pairs passed, plan return/reset matched the captured pose, plan orbit remained free, idle render count held `514 → 514`, and forced WebGL2 had zero console/page errors.
