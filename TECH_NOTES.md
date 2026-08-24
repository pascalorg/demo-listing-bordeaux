# Technical recon: scroll-driven 3D apartment listing

## Executive conclusions

- Pin **three.js `0.185.1` exactly**. Pascal declares `three ^0.185`, and the inspected workspace resolves to `0.185.1`. Its TSL/WebGPU code depends on r185-specific APIs.
- The apartment GLB requires **Meshopt and KTX2/BasisU**. It does **not** use Draco.
- The layout-to-GLB mapping is exact and simple:

  ```text
  GLB.X = layout[0]
  GLB.Y = elevation
  GLB.Z = layout[1]
  ```

  Scale is 1.0, units are metres, and there is no offset or axis flip.
- Do not auto-center or rescale this GLB. Doing so would break every zone, camera, opening, and furniture coordinate.
- The GLB’s complete scene bounds are dominated by the 30 × 30 m site plane. Camera fitting should use the `building_rghsy6udcgia7kij` subtree instead.
- Pascal’s zone polygons are suitable for hit-testing, labels, camera targets, and overlays, but **not** for publishing sale areas. Their adjusted total is `118.074 m²`, versus `92.5 m²` official, a `+27.6%` discrepancy.
- The closest practical reproduction of Pascal’s appearance is:
  - procedural environment map;
  - Studio-theme ambient, hemisphere, key and fill lights;
  - fitted directional shadow camera;
  - SSGI used as AO only;
  - depth/normal screen-space ink;
  - custom sky/horizon gradient;
  - ACES filmic tone mapping at exposure `0.9`.
- On WebGL2 fallback, render the base PBR scene directly and disable SSGI, denoise, and the custom merged outline. Use structural `EdgesGeometry` lines only if an edge fallback is essential.

---

## Inputs inspected

- UX template: `/Users/wawa/Downloads/listing-cenon/listing-kastanjelaan-4b-story.html`
- Apartment asset: `/Users/wawa/Downloads/listing-cenon/lod0 (9).glb`
- Pascal graph: `/Users/wawa/Downloads/listing-cenon/layout_2026-08-20.json`
- Pascal viewer: `/Users/wawa/Documents/Projects/pascal/private-editor/editor/packages/viewer/src`
- Pascal viewer package version: `1.0.0-beta.5`
- Resolved three.js version: `0.185.1`

The inspection was read-only.

---

# 1. Demo page: interaction and presentation model

## Page architecture

The template uses a strong and reusable division between the scroll document and a persistent 3D viewport:

```text
fixed 52 px top bar
└── fixed 3D stage below it
    ├── canvas
    ├── fixed story cards
    ├── projected geometry pins
    ├── chapter rail
    └── scroll cue

scrolling body
├── empty story track: one viewport per beat
└── conventional document
    ├── plan and technical data
    ├── CTA
    └── footer
```

Important CSS/UI traits:

- Editorial palette in OKLCH, serif display type, system sans body, mono metadata.
- Fixed stage starts below `--nav: 52px`.
- Story cards use translucent near-black panels and `backdrop-filter: blur(16px)`.
- Desktop cards are compositionally placed left/right/top/bottom; mobile collapses them to a bottom sheet.
- Projected labels are ordinary DOM nodes positioned from `Vector3.project(camera)`.
- Chapter navigation is a fixed vertical dot rail.
- The scroll section is followed by a normal light-background document, so the experience has a definite ending.
- `prefers-reduced-motion` removes smooth scrolling and interpolation.
- There is a full non-WebGL document fallback.

## Scroll model

There are eight beats:

1. Overview
2. The floor
3. Living room
4. Staging
5. Terrace
6. Gallery hall
7. Primary bedroom
8. The plan

The scroll track height is:

```js
track.style.height = window.innerHeight * BEATS.length + 'px'
```

Normalized scroll is converted to beat-space, from `0` through `BEATS.length - 1`. Camera motion is smoothed twice:

```js
bpS = RM ? bp : bpS + (bp - bpS) * 0.14

const t = clamp(bpS - i, 0, 1)
const eased = t * t * (3 - 2 * t)
pos.lerpVectors(keyA.p, keyB.p, eased)
target.lerpVectors(keyA.t, keyB.t, eased)
```

This is a good vanilla architecture: scroll updates a target state, while `requestAnimationFrame` eases the rendered state toward it.

Story-card opacity uses a short `0.52`-beat envelope. Pins use `0.42`. This keeps only one chapter legible at a time while allowing crossfades.

## Camera keyframes

A beat is either:

- an explicit interior camera: `eye`, `tgt`, `fov`, `off`; or
- a fitted orbit: `orb: [azimuth, elevation, distanceScale]`.

Orbit distance is derived from model width, depth, height, aspect ratio, FOV, azimuth, elevation, and a `1.16` margin.

Copy-safe framing is achieved with camera view offsets:

```js
cam.setViewOffset(w, h, ox * w, oy * h, w, h)
```

On mobile, horizontal offset is removed and the frame is shifted upward:

```js
if (w <= 900) {
  ox = 0
  oy = 0.13
}
```

When flying between two interior cameras separated by more than `1.5 m`, the camera arcs upward:

```js
pos.y += Math.sin(Math.PI * eased) * 2.7
```

This is worth retaining: it avoids visually passing through walls during chapter changes.

Mouse dragging adds a constrained exploratory yaw:

```js
userAz = clamp(userAz - deltaX * 0.005, -0.55, 0.55)
```

For explicit interior cameras, that yaw changes the look target rather than moving the camera. Touch does not capture drag, preserving page scrolling.

## Rendering strategy

The demo is an older three.js r128 WebGL implementation:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
```

It uses:

- `WebGLRenderer`
- `PCFSoftShadowMap`
- `ACESFilmicToneMapping`
- exposure `0.95`
- DPR capped at `1.75`
- a hemisphere light
- one shadowed directional light
- one fill directional light
- five local point lights

The stage renders only while scroll, camera, or material state is changing. This “dirty render” pattern should be kept, especially because Pascal’s SSGI/denoise chain is expensive.

## Procedural placeholder versus the real asset

The demo generates a completely different `16.8 × 9.6 × 2.9 m` apartment from boxes. Its GLB drag-and-drop handler then:

1. measures an arbitrary GLB;
2. scales its largest horizontal extent to `16.8`;
3. recenters it at positive coordinates.

That logic must **not** be carried into the real implementation. The real apartment is already in metre-scale Pascal coordinates, mostly in negative X. Scaling or recentering it would invalidate the layout JSON.

## Other reusable ideas

- Room pins are built from data, not hand-authored HTML.
- The same model generates offscreen staging thumbnails.
- Roof/ceiling visibility is camera-height dependent.
- Exterior dollhouse views cull camera-side walls.
- The floor-plan SVG is generated from the same room/wall data.
- The final technical document remains usable if 3D fails.
- The template exposes important listing information in HTML rather than hiding it in canvas.

For this apartment, keep the presentation structure but replace the demo’s rectangular room model and its fabricated listing facts.

---

# 2. GLB binary audit

## Container

| Property | Value |
|---|---:|
| File size | `3,684,884 bytes` |
| GLB version | `2` |
| JSON chunk | `684,148 bytes` |
| BIN chunk | `3,000,708 bytes` |
| Generator | `glTF-Transform v4.4.0` |
| Scenes | `1` |
| Default scene | `0` |
| External resources | None; geometry and images are embedded |

## Extensions

### Required

```json
[
  "EXT_meshopt_compression",
  "KHR_mesh_quantization",
  "KHR_texture_basisu"
]
```

### Used but not required

```json
[
  "KHR_materials_emissive_strength",
  "KHR_materials_unlit",
  "KHR_texture_transform"
]
```

### Compression verdict

- Draco: **no**
- Meshopt: **yes, required**
- KTX2/BasisU: **yes, required**
- Mesh quantization: **yes, required**

`1115` of `1151` buffer views carry `EXT_meshopt_compression`:

- `1114` attribute streams
- `1` triangle/index stream

Accessor bounds are often quantized `Int16` values near `±32767`; they are not meaningful world coordinates until Meshopt decoding, normalized conversion, and node transforms are applied.

## Scene counts

| Resource | Count |
|---|---:|
| Nodes | `1,171` |
| Nodes with meshes | `921` |
| Mesh definitions | `520` |
| Unique primitives | `610` |
| Primitive instances | `1,011` |
| Materials | `63` |
| Textures | `36` |
| Images | `36` |
| Samplers | `1` |
| Accessors | `1,206` |
| Buffer views | `1,151` |
| Animations | `27` |
| Cameras | `0` |
| Skins | `0` |

Geometry totals:

| Metric | Unique geometry | Instanced scene |
|---|---:|---:|
| Vertices | `69,626` | `96,110` |
| Triangles | `47,919` | `66,994` |

Primitive modes:

- `609` triangle primitives (`mode 4`)
- `1` line-strip primitive (`mode 3`), associated with site/plan geometry

## Textures

All 36 images are embedded `image/ktx2` payloads with `vkFormat = 0`, so all require Basis transcoding.

| KTX2 encoding | Count | Transfer |
|---|---:|---|
| ETC1S / BasisLZ | `25` | `13` linear, `12` sRGB |
| UASTC / Zstd | `11` | all linear |

Dimensions:

- `35 × 512 × 512`, 10 mip levels
- `1 × 1024 × 1024`, 11 mip levels
- Embedded KTX2 payload total: `2,154,529 bytes`

All current textures are block-aligned, so Pascal’s odd-dimension WebGPU fallback is not triggered by this asset.

Texture-slot use across materials:

| Slot | Material references |
|---|---:|
| Base color | `12` |
| Normal | `11` |
| Metallic/roughness | `9` |
| Occlusion | `6` |

## Materials

Material summary:

- `63` materials
- `4` alpha-blended
- `2` double-sided
- `1` unlit
- `11` use emissive-strength
- `24` carry Pascal’s `__pascalCachedMaterial` extra
- only two human-readable material names: `slot_picture` and `slot_fixtures`

The asset includes ordinary PBR, glass-like blends, emissive appliance/electronic details, and textured furniture. The listing viewer should preserve the authored GLB materials by default.

## Bounds, axis, and units

Decoded and transformed scene bounds:

```text
Full scene, including site:
min = (-15.000000, -0.050000, -15.000000)
max = ( 15.000000,  2.550000,  15.000000)
size = (30.000000, 2.600000, 30.000000)
```

Apartment building subtree:

```text
min = (-10.355504, -0.000074, -5.150154)
max = ( -0.378002,  2.550000,  8.550148)
size = (  9.977502,  2.550074, 13.700302)
center = (-5.366753, 1.274963, 1.699997)
```

Conventions:

- Y-up
- X/Z horizontal plane
- metres by glTF convention and confirmed by the Pascal dimensions
- floor surface is approximately `Y = 0.05`
- wall/ceiling envelope reaches approximately `Y = 2.55`

Use the building subtree for camera fitting. Using `Box3.setFromObject(gltf.scene)` will fit to the 30 m site and make the apartment unnecessarily small.

## Hierarchy

Depth distribution:

| Depth | Nodes |
|---:|---:|
| 0 | `1` |
| 1 | `1` |
| 2 | `3` |
| 3 | `1` |
| 4 | `104` |
| 5 | `130` |
| 6 | `455` |
| 7 | `241` |
| 8 | `207` |
| 9 | `28` |

Maximum depth is `9`.

Representative structure:

```text
depth 0  scene-renderer
└── depth 1  site_ttc6fib827axc14b
    ├── depth 2  building_rghsy6udcgia7kij
    │   └── depth 3  level_ij405dbg1393bexe
    │       ├── depth 4  slabs, ceilings, walls, fences, zones, floor items
    │       │   ├── depth 5  doors, windows, wall-hosted items, mesh children
    │       │   └── depth 6–9  imported item/cabinet/model internals
    │       └── …
    ├── depth 2  unnamed site mesh
    └── depth 2  unnamed site line mesh
```

There are `141` Pascal semantic identity nodes in `extras`, matching the layout graph except for the guide node:

| Pascal kind | Count |
|---|---:|
| wall | 44 |
| item | 23 |
| slab | 13 |
| ceiling | 13 |
| cabinet-module | 12 |
| door | 11 |
| zone | 9 |
| window | 5 |
| fence | 3 |
| cabinet | 3 |
| shelf | 2 |
| site/building/level | 1 each |

Room names do **not** appear in `node.name`. Zone node names are IDs such as:

```text
zone_gsfdc0exxe3io1ef
zone_gbz5c3a6iaam3tjr
…
```

Human-readable names are preserved in `node.extras.label`, alongside `pascalId`, `kind`, `polygon`, and `color`. For example:

```json
{
  "pascalId": "zone_gsfdc0exxe3io1ef",
  "kind": "zone",
  "label": "Séjour / Cuisine",
  "polygon": [[-10.2, -5.1], [-2.2, -5.1], "..."],
  "color": "#ef4444"
}
```

This means the GLB alone can reconstruct zone overlays and labels; the JSON is still needed for official data reconciliation and authored furniture/opening metadata.

## Animations

There are 27 animation clips:

- `14` cabinet/module “open” clips
- `11` door “open” clips
- `2` window “open” clips

The apartment GLB contains no camera and no `spawn` semantic node. Pascal’s walkthrough controller therefore falls back to `[0, 1.65, 0]`, which is outside the apartment envelope near the balcony edge. A vanilla implementation should explicitly provide a start pose; a safe initial eye pose is approximately:

```js
position = [-7.0, 1.65, 3.0]
yaw = 0 // looks toward -Z
```

---

# 3. Pascal layout graph

## Top level

```text
nodes: 142
rootNodeIds: ["site_ttc6fib827axc14b"]
installedPlugins:
- pascal:trees
- mint:assets
- pascal:articraft
- pascal:streetscape
```

Node type counts:

| Type | Count |
|---|---:|
| wall | 44 |
| item | 23 |
| slab | 13 |
| ceiling | 13 |
| cabinet-module | 12 |
| door | 11 |
| zone | 9 |
| window | 5 |
| fence | 3 |
| cabinet | 3 |
| shelf | 2 |
| site/building/level/guide | 1 each |

The level has:

```json
{
  "name": "Level 0",
  "level": 0,
  "height": 2.5,
  "baseElevation": 0
}
```

Slab elevation and thickness are generally `0.05 m`; ceilings are authored at `2.49 m`.

## Zone node format

A zone is a direct child of the level:

```json
{
  "object": "node",
  "id": "zone_…",
  "type": "zone",
  "name": "Séjour / Cuisine",
  "parentId": "level_…",
  "visible": true,
  "color": "#ef4444",
  "polygon": [
    [-10.2, -5.1],
    [-2.2, -5.1]
  ],
  "autoFromWalls": false,
  "boundaryWallIds": [],
  "ceilingHeight": 2.7,
  "spaceRole": "generic",
  "enclosureStatus": "auto"
}
```

Important distinctions:

- `zone.polygon` is a raw array of `[x, y]` pairs, unlike the site polygon’s `{type:"polygon", points:[…]}` wrapper.
- The second coordinate is planar layout Y, but becomes GLB Z.
- Coordinates are level-local metres.
- All nine apartment polygons have positive signed shoelace area and are therefore **counter-clockwise**.
- `WC` is the only zone with `autoFromWalls: true` and populated `boundaryWallIds`; the others are manually authored.
- GLB zone nodes are identity-only and contain no baked mesh.

## Coordinate mapping

The layout and GLB use the same horizontal origin and scale:

```js
function layoutToWorld([x, y], elevation = 0) {
  return new THREE.Vector3(x, elevation, y)
}
```

Evidence:

- layout site: `[-15, -15]` through `[15, 15]`
- GLB site: X/Z `[-15, 15]`
- layout building perimeter: approximately X `[-10.30, -0.40]`, Y `[-5.10, 8.50]`
- GLB building including wall thickness: X `[-10.3555, -0.3780]`, Z `[-5.1502, 8.5501]`
- wall, door, window, fence, and item centers match without offset or sign inversion

Do not apply the conventional `Z = -layoutY` flip.

## Zone areas and centroids

Centroids below are polygon area centroids and map directly to GLB `(X, Z)`.

| Zone | Computed area | Official area | Difference | Difference % | Centroid `(X,Z)` |
|---|---:|---:|---:|---:|---|
| Entrée | `9.389` | `7.60` | `+1.789` | `+23.5%` | `(-7.8475, 4.3911)` |
| Séjour + Cuisine | `42.804` | `33.30` | `+9.504` | `+28.5%` | `(-6.7316, -2.2481)` |
| Chambre 1 | `17.776` | — | — | — | `(-4.6541, 6.7490)` |
| Salle d’eau | `4.462` | — | — | — | `(-8.2250, 7.2250)` |
| Chambre 1 incl. salle d’eau | `22.239` | `17.40` | `+4.839` | `+27.8%` | separate polygons |
| Chambre 2 | `13.048` | `10.50` | `+2.548` | `+24.3%` | `(-4.3069, 3.2594)` |
| Chambre 3 | `11.830` | `9.40` | `+2.430` | `+25.9%` | `(-4.2875, 0.3028)` |
| Salle de Bains | `7.040` | `4.80` | `+2.240` | `+46.7%` | `(-8.9801, 3.0768)` |
| WC | `2.317` | `1.50` | `+0.817` | `+54.5%` | `(-9.6942, 6.9270)` |
| Balcon | `9.408` | `8.00` | `+1.408` | `+17.6%` | `(-1.2876, -1.6624)` |
| **Total** | **`118.074`** | **`92.50`** | **`+25.574`** | **`+27.6%`** | |

The likely explanation is that zone boundaries are wall-centerline/gross interaction footprints, while official areas are net sale measurements. The area pattern is too systematic to be floating-point error.

Recommendations:

- Use official numbers in listing copy.
- Use polygons for zone selection, camera targeting, and graphical highlighting only.
- Do not claim the plan areas are “drawn from the model” until net-area polygons or a reconciliation rule exists.
- Preserve the separate `Salle d’eau` label even if the official brochure groups it into Chambre 1.

### Pascal label positions versus geometric centroids

`glb-scene.tsx` does not calculate an area centroid. It averages vertices:

```js
const centroid = [
  polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length,
  polygon.reduce((sum, [, z]) => sum + z, 0) / polygon.length,
]
```

This differs materially for concave rooms:

| Zone | Pascal vertex mean | Geometric centroid |
|---|---|---|
| Séjour / Cuisine | `(-6.2667, -1.5083)` | `(-6.7316, -2.2481)` |
| Entrée | `(-8.1252, 4.0333)` | `(-7.8475, 4.3911)` |
| Balcon | `(-1.4500, -1.1200)` | `(-1.2876, -1.6624)` |

For reproduction, use the vertex mean. For camera targets or robust label placement, use the area centroid or a polylabel/interior-point algorithm.

## Openings

An opening’s horizontal center is stored as a distance along its parent wall:

```js
const direction = normalize(wall.end - wall.start)
const centerXZ = wall.start + direction * opening.position[0]
```

Wall base elevation contributes approximately `0.05 m` to the rendered GLB Y position.

### Doors

| Door | Parent wall, start → end | Along wall | Rendered center `(X,Y,Z)` | Size | Type/state |
|---|---|---:|---|---|---|
| `door_cvdmtaj49xgwpnfh` | `wall_1smm…`: `(-2.2,-5.1) → (-2.2,-1.1)` | `2.000` | `(-2.200,1.100,-3.100)` | `1.50 × 2.10` | French, closed |
| `door_ag9skdapevwexb3u` | same wall | `3.430` | `(-2.200,1.100,-1.670)` | `0.90 × 2.10` | hinged, `0.65` open |
| `door_re5197qjorrzg9om` | `wall_htlam…`: `(-2.2,-1.1) → (-2.2,1.7)` | `1.500` | `(-2.200,1.100,0.400)` | `0.90 × 2.10` | hinged, `0.65` open |
| `door_xa9urfa1vnsu3bjr` | `wall_16oq…`: `(-6.4,-1.1) → (-6.4,1.7)` | `2.200` | `(-6.400,1.100,1.100)` | `0.90 × 2.10` | hinged, closed |
| `door_93r56tj0ns978ysb` | `wall_gv6n…`: `(-6.4,1.7) → (-7.7,1.7)` | `0.700` | `(-7.100,1.100,1.700)` | `0.90 × 2.10` | hinged, closed |
| `door_u3fq4alfbbe96kmh` | `wall_elu9…`: `(-7.7,4.45) → (-7.7,1.7)` | `0.750` | `(-7.700,1.100,3.700)` | `0.90 × 2.10` | hinged, closed |
| `door_ljifrep0a6p4q8ub` | `wall_aqa0…`: `(-6.4,4.85) → (-6.4,1.7)` | `0.550` | `(-6.400,1.100,4.300)` | `0.90 × 2.10` | hinged, closed |
| `door_3kh9r2ppabwi0z9z` | `wall_elw8…`: `(-6.4,4.85) → (-6.4,5.95)` | `0.550` | `(-6.400,1.100,5.400)` | `0.90 × 2.10` | hinged, closed |
| `door_2udbl7hf9ws2cdnr` | `wall_w6af…`: `(-7.35,5.95) → (-7.35,8.5)` | `0.800` | `(-7.350,1.100,6.750)` | `0.90 × 2.10` | pocket, fully open |
| `door_uirfyp8b8t9rqo1g` | `wall_o4ss…`: `(-10.281,5.950) → (-9.1,5.95)` | `0.600` | `(-9.681,1.100,5.950)` | `0.90 × 2.10` | hinged, closed |
| `door_9rwqspby3hxwhvdw` | `wall_z3vy…`: `(-10.281,5.950) → (-10.270,4.450)` | `0.900` | `(-10.275,1.100,5.050)` | `0.90 × 2.10` | hinged, closed |

### Windows

| Window | Parent wall, start → end | Along wall | Rendered center `(X,Y,Z)` | Size | Type |
|---|---|---:|---|---|---|
| `window_a6vip5394mqliunl` | `wall_c7p5…`: `(-10.245,1.000) → (-10.206,-4.250)` | `3.400` | `(-10.220,1.584,-2.400)` | `1.50 × 0.933` | fixed |
| `window_65429obxsrkdlfwu` | `wall_ziks…`: `(-2.2,1.7) → (-2.2,4.85)` | `1.475` | `(-2.200,1.272,3.175)` | `1.001 × 1.448` | fixed |
| `window_cheeuc6e0qbb0e44` | `wall_7b6n…`: `(-2.2,4.85) → (-2.2,8.5)` | `1.000` | `(-2.200,1.272,5.850)` | `1.001 × 1.448` | fixed |
| `window_3m1xulim4g7qyymr` | `wall_493t…`: `(-10.270,4.450) → (-10.256,2.500)` | `1.260` | `(-10.261,1.346,3.189)` | `0.596 × 0.601` | casement |
| `window_na0kpry3ce7q06yi` | `wall_3n7r…`: `(-10.296,7.900) → (-10.281,5.950)` | `1.050` | `(-10.288,1.346,6.850)` | `0.596 × 0.601` | casement |

These are useful window-facing camera targets. The large living-side fixed window is centered at `(-10.220, 1.584, -2.400)`; the balcony-facing doors are centered at X `-2.2`, Z `-3.10` and `-1.67`.

## Balcony fences

The balcony occupies approximately X `[-2.2, -0.4]`, Z `[-4.3, 1.0]`. Three fence nodes enclose its exposed sides:

| Fence | Start → end | Length |
|---|---|---:|
| `fence_gab7o0cdf7hmz91z` | `(-2.2,-4.3) → (-0.4,-4.3)` | `1.8 m` |
| `fence_5287gjcb8slan772` | `(-0.4,-4.3) → (-0.4,1.0)` | `5.3 m` |
| `fence_7yd5l2ficy3f7gna` | `(-0.4,1.0) → (-2.2,1.0)` | `1.8 m` |

Common authored settings:

```text
style: privacy
height: 1.07
thickness: 0.08
postSize: 0.10
postSpacing: 0.51
slatGap: 0.01
baseStyle: floating
baseHeight: 0.04
topRailHeight: 0.04
postCap: pyramid
```

The open side is the apartment-facing edge at approximately X `-2.2`.

Useful camera points:

```text
Balcony geometric center: (-1.2876, 0.05, -1.6624)
Balcony label mean:       (-1.4500, 1.00, -1.1200)
Séjour geometric center: (-6.7316, 0.05, -2.2481)
```

## Furniture/items

The JSON contains 23 `item` nodes. Resolved GLB node origins are shown where wall/shelf parenting otherwise makes the stored local position misleading.

| Item | World node origin `(X,Y,Z)` | Notes |
|---|---|---|
| Dracaena | `(-2.850,0.050,-4.550)` | scale `1.2`; near balcony doors |
| Angled Sofa | `(-5.015,0.050,-3.720)` | asset ID oddly says `bathroom-cabinet-mqqq8ne8` |
| Double Bed | `(-3.785,0.050,7.444)` | Chambre 1 |
| Double Bed | `(-4.141,0.050,2.775)` | Chambre 2 |
| Double Bed | `(-4.069,0.050,-0.047)` | Chambre 3 |
| Closet | `(-6.101,0.000,8.130)` | `1.95 × 2.26 × 0.60` |
| Round Nightstand | `(-2.671,0.050,8.068)` | scale `0.7` |
| Round Nightstand | `(-4.861,0.050,8.134)` | scale `0.7` |
| Squared Shower | `(-8.725,0.050,8.025)` | Salle d’eau |
| Single Vanity | `(-8.800,0.050,6.650)` | Salle d’eau |
| Toilet | `(-9.750,0.050,7.500)` | WC |
| Toilet | `(-8.925,0.050,2.175)` | Salle de Bains |
| Bathroom Sink | `(-8.600,0.050,4.125)` | nonuniform scale |
| Bathtub | `(-9.750,0.050,3.475)` | scale `(0.83,1,0.89)` |
| Washing Machine | `(-9.925,0.050,0.650)` | séjour/service edge |
| Trash Bin | `(-9.925,0.050,-3.425)` | kitchen |
| Microwave | `(-8.040,0.939,-4.745)` | shelf child |
| TV Wall | `(-4.300,1.050,-1.150)` | wall-hosted |
| Picture | `(-8.650,1.250,4.400)` | wall-hosted |
| Square Frame | `(-6.500,1.450,-5.050)` | wall-hosted |
| Square Frame | `(-9.050,1.300,6.650)` | wall-hosted |
| Towel Rack | `(-7.750,0.800,2.350)` | wall-hosted |
| Towel Rack | `(-8.150,0.750,6.000)` | wall-hosted |

---

# 4. Pascal viewer techniques

## three.js version

`packages/viewer/package.json` declares:

```json
"peerDependencies": {
  "three": "^0.185"
}
```

The installed package is `three 0.185.1`. Type declarations are deliberately pinned to `@types/three 0.184.0` because the project reports a TypeScript-Go inference/OOM issue with r185 types.

## Renderer and camera

Default perspective camera:

```tsx
<PerspectiveCamera
  near={0.1}
  far={1000}
  fov={50}
  position={[10, 10, 10]}
/>
```

Walkthrough temporarily widens it to `60°`.

Renderer setup:

```ts
const renderer = new THREE.WebGPURenderer({
  canvas,
  alpha: true,
  antialias: true,
})

await renderer.init()

renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.9
```

DPR caps:

- desktop: `1.5`
- coarse pointer/mobile: `1.25`

The renderer is initialized asynchronously and cached per canvas to avoid duplicate renderer creation under React reconfiguration. Pascal also probes WebGPU with a 4-second timeout and explicitly retries with `forceWebGL: true`.

## Post-processing chain

Pascal uses `RenderPipeline`, not `EffectComposer`.

The order is:

1. Main scene pass: layers 0 and 3
2. Zone pass: layer 2
3. Overlay pass: layer 1
4. Main depth/diffuse/normal MRT
5. SSGI/AO
6. AO denoise
7. Zone additive composite
8. Screen-space ink
9. Scene-referred contrast/saturation grade
10. Selection/hover outline
11. World-direction sky/horizon backdrop
12. Crisp overlay composite
13. Output color transform/tone mapping

There is no SMAA/FXAA pass. Antialiasing is renderer MSAA.

### MRT

```ts
scenePass.setMRT(
  mrt({
    output,
    diffuseColor,
    normal: packNormalToRGB(normalView),
  }),
)

const depth = scenePass.getTextureNode('depth')
const normal = scenePass.getTextureNode('normal')
scenePass.getTexture('normal').type = UnsignedByteType
scenePass.getTexture('diffuseColor').type = UnsignedByteType
```

Background detection uses the main output alpha because WebGPU only reliably applies the MRT clear value to attachment zero.

### AO: SSGI configured as AO-only

```ts
export const SSGI_PARAMS = {
  enabled: true,
  sliceCount: 1,
  stepCount: 4,
  radius: 1,
  expFactor: 1.5,
  thickness: 0.5,
  backfaceLighting: 0.5,
  aoIntensity: 1.5,
  giIntensity: 0,
  useLinearThickness: false,
  useScreenSpaceSampling: true,
  useTemporalFiltering: false,
}
```

At `sliceCount 1 × stepCount 4 × 2`, this is roughly eight samples per pixel. Because `giIntensity` is zero, the SSGI node is effectively being used as screen-space AO.

r185 exposes separate outputs:

```ts
const aoTexture = giPass.getAONode()
const gi = giPass.getGINode().rgb
```

AO is replicated into RGB and denoised:

```ts
const aoAsRgb = vec4(ao.r, ao.r, ao.r, 1)
const denoisePass = denoise(aoAsRgb, depth, sceneNormal, camera)
denoisePass.index.value = 0
denoisePass.radius.value = 4
```

Composite:

```ts
scene.rgb * ao + zone.rgb + diffuse.rgb * gi
```

AO fades back to 1 between raw depths `0.9994` and `0.9998`, preventing a dark horizon band.

### Color grade

```ts
const graded = saturation(
  rgb.div(0.18).pow(vec3(1.05)).mul(0.18),
  1.1,
)
```

The source comment says “AgX,” but the actual viewer sets `ACESFilmicToneMapping`. The runtime setting is authoritative.

## Screen-space ink edges

`ink-edges.ts` detects both depth discontinuities and normal creases from the MRT.

Critical TSL:

```ts
const px = vec2(1, 1).div(screenSize).mul(radius)

const depthLap = abs(
  dR.add(dL).add(dU).add(dD).sub(dC.mul(4)),
)

const invDepth = float(1).sub(dC)
const depthMetric = depthLap.div(
  invDepth.mul(invDepth).add(float(0.00002)),
)

const noiseGate = smoothstep(0.00002, 0.00006, depthLap)
const depthEdge = smoothstep(0.5, 2.5, depthMetric).mul(noiseGate)

const nDiff = max(
  max(float(1).sub(nC.dot(nR)), float(1).sub(nC.dot(nL))),
  max(float(1).sub(nC.dot(nU)), float(1).sub(nC.dot(nD))),
)

const normalEdge = smoothstep(0.01, 0.05, nDiff)
const distanceFade = float(1).sub(
  smoothstep(0.9994, 0.9998, dC),
)

const mask = min(
  max(depthEdge, normalEdge)
    .mul(opacity)
    .mul(distanceFade),
  1,
)

return mix(sceneRgb, inkColor, mask)
```

Parameters:

- sample radius: `1 px`
- soft mode opacity: `0.5`
- strong mode opacity: `1.0`
- dark-theme opacity scale: `0.7`

Despite an older comment referring to `2 px`, current code uses radius `1` for both soft and strong.

Ink color:

- light backdrop: `#1a1d24`
- dark backdrop: background RGB moved `42%` toward white

This technique is preferable to geometry outlines for CSG walls, furniture, window reveals, and triangle-soup assets.

## Selection/hover outline

`merged-outline-node.ts` is a fork of three’s `OutlineNode` that handles two object sets:

- primary: selected
- secondary: hovered

It shares a single non-selected depth pass.

Allocated render targets:

- one shared depth target
- seven targets for primary
- seven targets for secondary
- total: 15

Per active group:

1. full-resolution mask
2. downsample mask by ratio `2`
3. edge detection
4. horizontal thickness blur
5. vertical thickness blur
6. second horizontal glow blur at half resolution
7. second vertical glow blur
8. full-resolution composite

The edge detector writes:

- R = visible edge
- G = hidden edge

Selected style:

```text
visible: white
hidden: #f3ff47
strength: 3
thickness: 1
```

Hovered style:

```text
visible: #00aaff
hidden: #f3ff47
strength: 5
thickness: 1.5
period: 3 seconds
pulse: sine
```

The blur uses a Gaussian kernel with maximum radius `4` and separable X/Y passes.

This node depends on private/unstable renderer APIs:

```text
RendererUtils.resetRendererAndSceneState
RendererUtils.restoreRendererAndSceneState
renderer.setRenderObjectFunction
QuadMesh
TempNode
NodeUpdateType.FRAME
```

For a listing with no object selection, omit it. Zone tints plus ink are sufficient and much cheaper.

## Lights and shadows

The recommended matching theme is Pascal’s `studio` theme:

```js
{
  background: '#fbfbfa',
  backgroundSky: '#b6cfe7',
  ground: '#e9e7e2',
  ambient: { color: '#ffffff', intensity: 0.15 },
  hemi: { sky: '#ffffff', ground: '#aaa49a', intensity: 0.45 },
  lights: [
    {
      position: [10, 10, 10],
      color: '#ffffff',
      intensity: 4,
      castShadow: true
    },
    {
      position: [-10, 10, -10],
      color: '#ffffff',
      intensity: 0.6
    }
  ],
  toneMappingExposure: 0.9
}
```

Shadow constants:

```text
mapSize: 1024 × 1024
type: PCFShadowMap
radius: 2
bias: -0.0005
normalBias: 0.08
maximum shadow intensity: 0.75
```

The shadow camera is fitted to scene geometry excluding the site:

```text
bounds refresh: every 0.4 seconds
sphere margin scale: 1.15
fixed extra margin: 3 m
backoff: 10 m
fallback radius: 30 m

size = sphereRadius * 1.15 + 3
distance = size + 10
near = 10
far = distance + size
```

The theme light position is treated as a direction, normalized, then placed relative to the fitted sphere center.

Light/color changes use:

```js
const t = Math.min(delta, 0.1) * 4
current = lerp(current, target, t)
```

## Environment lighting

Pascal replaces an HDR fetch with a procedural `64 × 32` float equirectangular texture.

Linear-space stops:

```text
zenith: (0.40, 0.56, 0.78)
horizon: (0.95, 0.84, 0.66)
ground: (0.38, 0.35, 0.30)
```

Above the horizon:

```js
const t = latitude ** 0.65
color = mix(HORIZON, ZENITH, t)
```

Below the horizon, the ground bounce darkens by up to 35% toward the nadir.

Texture properties:

```js
texture.mapping = EquirectangularReflectionMapping
texture.colorSpace = LinearSRGBColorSpace
scene.environmentIntensity = 0.6 // light themes
scene.environmentIntensity = 0.2 // dark themes
```

The environment is used for IBL only; it is not the visible background.

## Backdrop

The visible backdrop is composited in post from each pixel’s world-space view direction.

Core formula:

```ts
let base = mix(background, sky, smoothstep(-0.02, 0.14, dirY))
base = mix(base, skyDeep, smoothstep(0.1, 0.55, dirY))

const hazeWeight = exp(abs(dirY).mul(-11)).mul(0.8)
return mix(base, haze, hazeWeight)
```

`horizonHazeColor()` pulls the sky color toward `[255,244,222]`:

- 50% for light themes
- 25% for dark themes

`deepSkyColor()` converts the theme sky to HSL, increases saturation, and multiplies lightness by `0.72`.

The fullscreen pass reconstructs world direction using the inverse scene-camera projection and world matrices. This is necessary because the post quad has its own camera.

## Materials

Rendered mode uses `MeshStandardNodeMaterial`; solid mode uses `MeshLambertNodeMaterial`.

Notable defaults:

| Surface | Color | Roughness |
|---|---|---:|
| base | `#e9e7e3` | `0.5` |
| wall | `#e9e6e0` | `0.9` |
| slab | `#e5e5e5` | `0.8` |
| ceiling | `#ebebd3` | `0.95` |
| roof | `#808080` | `0.85` |
| door | `#8b4513` | `0.7` |

Glass:

```ts
const facing = transformedNormalView
  .dot(positionViewDirection)
  .clamp(0, 1)

const fresnel = facing.oneMinus().pow(3)

material.opacityNode = mix(
  float(material.opacity),
  float(0.92),
  fresnel,
)

material.envMapIntensity = 1.4
```

Any transparent standard material with opacity below `0.6` receives that Fresnel treatment.

A critical Pascal workaround forces node materials away from `DoubleSide` during MRT rendering. Their WebGPU backend produced missing fragment outputs for the back-face MRT pipeline. Glass is always `FrontSide`; meshes that need the opposite face are rotated.

For this GLB, first try the loader-generated materials unchanged. Only replace materials when implementing an explicit monochrome/clay mode.

## Zone rendering

The parametric `ZoneSystem` does not create zone geometry. It only animates existing `floor` and `walls` children:

- hover entry is immediate;
- exit is debounced by `50 ms`;
- transition duration is `400 ms`;
- per-frame opacity lerp uses `10 × delta`.

The GLB viewer reconstructs zone geometry from `extras.polygon`.

Floor material:

```ts
new MeshBasicNodeMaterial({
  colorNode: color(zoneColor),
  opacityNode: float(0.25).mul(opacityUniform),
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
  transparent: true,
})
```

Wall-border material:

```ts
new MeshBasicNodeMaterial({
  colorNode: color(zoneColor),
  opacityNode: float(0.6)
    .mul(float(1).sub(uv().y))
    .mul(opacityUniform),
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
  transparent: true,
})
```

The border consists of vertical quads along every polygon edge:

```text
base Y: 0.01
height: 2.3 m
UV.y: 0 at floor, 1 at top
```

The floor is made with `ShapeGeometry`, rotated `-π/2`, at `Y = 0.02`.

Both meshes:

- live on layer 2;
- never raycast;
- are hidden below opacity `0.01`;
- are rendered in their own additive pass.

Focused-level behavior:

- normal room opacity target: `0.65`
- hovered room target: `1.0`
- transition: `lerp(current, target, min(1, delta × 8))`
- hidden once the user drills into a specific room
- disabled entirely in walkthrough mode

Labels are DOM overlays at:

```js
[vertexMeanX, 1, vertexMeanZ]
```

Default scale is `0.82`; hovered scale is `1`; opacity transition is `0.3 s`.

## Shadow-only cutaway

When ceilings or roofs are hidden for dollhouse views, Pascal keeps them in shadow maps using layers:

```text
scene: 0
overlay: 1
zone: 2
grid: 3
shadow-only: 4
batched geometry: 5
```

`applyShadowOnly()` traverses an object, disables layer 0 and enables layer 4. Only the directional light’s shadow camera enables layer 4.

This is worth copying: setting `visible = false` would also remove the object from the shadow pass and flood the interior with direct sun.

## KTX2 and Meshopt loading

Pascal’s GLB hook ultimately performs:

```ts
configureKtx2Support(loader, renderer)
loader.setMeshoptDecoder(MeshoptDecoder)
```

The KTX2 loader is shared and calls `detectSupport(renderer)` once before loading.

Pascal also subclasses `KTX2Loader` to handle future odd-sized Basis textures:

1. read KTX2 width/height;
2. if dimensions are not multiples of four, force RGBA32 transcoding;
3. repackage the result as `DataTexture`, because WebGPU otherwise still treats the result as block-compressed.

This asset’s dimensions are all safe, but the workaround is useful for future user-supplied furniture.

## Walkthrough

Controls:

```text
W / ArrowUp: forward
S / ArrowDown: backward
A / ArrowLeft: left
D / ArrowRight: right
Space: jump
Shift: run
Ctrl: crouch
P: release/reacquire pointer without leaving walkthrough
Esc/unlock: exit
```

Look sensitivity:

```text
0.002 radians per mouse pixel
pitch clamp: ±(π/2 - 0.05)
FOV: 60°
```

Physics parameters:

| Parameter | Value |
|---|---:|
| gravity | `9.81` |
| falling gravity factor | `4` |
| jump velocity | `5` |
| walk speed | `2 m/s` |
| run speed | `5 m/s` |
| acceleration | `26` |
| deceleration | `30` |
| air drag | `0.3` |
| maximum slope | `1.2 rad` |
| collision iterations | `3` |
| push-back damping | `0.1` |
| push-back threshold | `0.001` |
| float spring | `1200` |
| float damping | `36` |
| float sensor radius | `0.15` |
| float pull-back height | `0.35` |

Standing capsule:

```js
[radius, length, capSegments, radialSegments] = [0.25, 0.8, 4, 8]
floatHeight = 0.5
eyeOffset = 0.45
```

Crouching:

```js
capsule = [0.25, 0.2, 4, 8]
floatHeight = 0.25
eyeOffset = 0.1
walk/run = 1.0 / 1.4
standing clearance = 1.25
eye interpolation speed = 12
```

Collider construction:

1. traverse visible scene meshes;
2. exclude kinds `zone`, `spawn`, `ceiling`, `roof`, `door`, and `window`;
3. convert quantized/interleaved positions to plain Float32;
4. make indexed geometries non-indexed;
5. bake `matrixWorld`;
6. merge all geometry;
7. add a `2000 × 2000 × 0.08 m` fallback floor at the lowest level;
8. build `three-mesh-bvh` with `maxLeafSize: 12`, strategy `0`.

Collider material metadata:

```js
{
  type: 'STATIC',
  friction: 0.8,
  restitution: 0.05
}
```

This is effective but much more machinery than a scroll listing requires. A listing can defer loading the walkthrough controller until the user explicitly enters tour mode.

## Small utilities worth porting

The following are compact and broadly useful:

- `edgeColorFor()` and `edgeOpacityScaleFor()`
- `horizonHazeColor()` and `deepSkyColor()`
- `pointInPolygon()` / `pointInPolygonInclusive()`
- `readMisalignedBasisSize()`
- `toFloat32Position()`
- `isEffectivelyVisible()` and semantic `kindOf()`
- `sanitizeOutlineObjects()`
- shadow-only layer helpers
- renderer initialization with WebGPU timeout and explicit WebGL2 retry
- the empty-position-buffer draw guard

---

# 5. Recommended vanilla/no-build implementation

## Exact dependency pin

Use `three@0.185.1` everywhere. Do not use a caret, do not mix CDN versions, and do not combine r185 core with loaders copied from another release.

Serve over HTTP. WebGPU generally requires a secure context; `localhost` is acceptable. Do not open the HTML with `file://`.

## Self-hosted tree

A minimal loader distribution preserving three’s relative paths is:

```text
vendor/three-r185.1/
├── build/
│   ├── three.module.js
│   ├── three.webgpu.js
│   └── three.tsl.js
└── examples/jsm/
    ├── loaders/
    │   ├── GLTFLoader.js
    │   └── KTX2Loader.js
    ├── libs/
    │   ├── meshopt_decoder.module.js
    │   ├── ktx-parse.module.js
    │   ├── zstddec.module.js
    │   └── basis/
    │       ├── basis_transcoder.js
    │       └── basis_transcoder.wasm
    ├── math/
    │   └── ColorSpaces.js
    └── utils/
        ├── BufferGeometryUtils.js
        ├── SkeletonUtils.js
        └── WorkerPool.js
```

If Pascal’s post chain is ported, also copy:

```text
examples/jsm/tsl/display/SSGINode.js
examples/jsm/tsl/display/DenoiseNode.js
```

Preserving the directory tree is important because `KTX2Loader.js` locates the transcoder and its helper modules through relative URLs.

## Import map

```html
<script type="importmap">
{
  "imports": {
    "three": "./vendor/three-r185.1/build/three.module.js",
    "three/webgpu": "./vendor/three-r185.1/build/three.webgpu.js",
    "three/tsl": "./vendor/three-r185.1/build/three.tsl.js",
    "three/addons/": "./vendor/three-r185.1/examples/jsm/",
    "three/examples/jsm/": "./vendor/three-r185.1/examples/jsm/"
  }
}
</script>
```

Both loader files import the bare specifier `three`; the first mapping is therefore mandatory.

Avoid importing `Addons.js` as a single aggregate. Import only the required deep modules.

## Loader wiring

```js
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  WebGPURenderer,
} from 'three/webgpu'

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const renderer = new WebGPURenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance',
})

await renderer.init()

renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 0.9
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFShadowMap

const ktx2 = new KTX2Loader()
  .setTranscoderPath(
    './vendor/three-r185.1/examples/jsm/libs/basis/',
  )
  .detectSupport(renderer)

const loader = new GLTFLoader()
loader.setKTX2Loader(ktx2)
loader.setMeshoptDecoder(MeshoptDecoder)

const gltf = await loader.loadAsync('./assets/apartment.glb')
```

The web server should return `application/wasm` for `basis_transcoder.wasm`.

## Renderer fallback

`WebGPURenderer` r185 automatically falls back to a WebGL2 backend when WebGPU is unavailable. For a more reliable production path:

1. construct `WebGPURenderer`;
2. await `renderer.init()`;
3. if initialization fails or times out, dispose it;
4. recreate with `{forceWebGL: true}`;
5. await initialization again.

After initialization, test the actual backend:

```js
const isRealWebGPU =
  renderer.backend?.isWebGPUBackend === true &&
  renderer.backend?.device != null
```

Do not use only `'gpu' in navigator`; WebGPU may exist while adapter/device initialization has failed and the renderer is running on WebGL2.

## Proposed scene setup

### Base scene

- Add the loaded scene without transforms.
- Traverse meshes once:
  - `castShadow = true` for opaque architectural/furniture meshes;
  - `receiveShadow = true` for floors, walls, slabs, furniture;
  - avoid forcing shadow casting on transparent glass.
- Find objects using `userData.pascalId` and `userData.kind`.
- Compute camera framing from the `building` identity subtree, not the root.
- Use perspective near/far approximately `0.1 / 100`, rather than Pascal’s generic `1000`, to improve depth precision for this small apartment.
- Preserve the site plane for contextual ground, but exclude it from fitting and shadow bounds.

### Lighting

Start with Pascal Studio values:

```text
ambient white, 0.15
hemisphere white / #aaa49a, 0.45
key direction [10,10,10], intensity 4, shadowed
fill direction [-10,10,-10], intensity 0.6
environment intensity 0.6
exposure 0.9
```

Fit the key’s orthographic shadow camera to the building bounds using Pascal’s sphere algorithm. A static listing can calculate this once after loading rather than every `0.4 s`.

### Environment and background

Build Pascal’s `64 × 32` float equirectangular environment texture.

For WebGPU, use the TSL backdrop gradient. For WebGL2 fallback, use either:

- a simple background color/vertical CSS gradient behind an alpha canvas; or
- a large unlit inverted sky sphere with the same gradient.

### Post chain

Desktop WebGPU:

1. scene/zone/overlay passes;
2. normal/depth MRT;
3. SSGI AO;
4. radius-4 denoise;
5. screen-space ink;
6. contrast/saturation grade;
7. backdrop;
8. ACES output.

Mobile WebGPU:

- keep ink;
- reduce or disable AO first;
- cap DPR at `1.25`;
- consider `sliceCount 1`, `stepCount 2`;
- skip selection outline.

WebGL2 fallback:

- direct scene render;
- no SSGI/denoise/merged outline;
- retain authored occlusion textures, IBL, and directional shadows;
- optionally add static `EdgesGeometry` lines only to walls/slabs/ceilings.

## Reproducing the zone look

The GLB already carries polygons and colors in `userData`, so no JSON join is required for visuals.

For each `kind === "zone"`:

1. read `userData.polygon`;
2. build a `ShapeGeometry` floor at `Y=0.02`;
3. build vertical edge quads from `Y=0.01` to `2.31`;
4. put both on a dedicated zone layer;
5. disable raycasting;
6. animate a shared opacity uniform;
7. position the DOM label using a geometric centroid or polylabel point.

For scroll storytelling, opacity can be driven directly by chapter progress instead of hover:

```text
inactive: 0
context floor: 0.65
active room: 1
```

## Camera and story targets

Use the true polygon centroids as targets at approximately `Y=1.0–1.2`:

```text
Séjour / Cuisine: (-6.7316, 1.10, -2.2481)
Balcon:           (-1.2876, 0.80, -1.6624)
Entrée:           (-7.8475, 1.10,  4.3911)
Chambre 1:        (-4.6541, 1.10,  6.7490)
Chambre 2:        (-4.3069, 1.10,  3.2594)
Chambre 3:        (-4.2875, 1.10,  0.3028)
Salle de Bains:   (-8.9801, 1.10,  3.0768)
WC:               (-9.6942, 1.10,  6.9270)
```

A sensible adapted chapter order is:

1. exterior/dollhouse overview fitted to building bounds;
2. top-down plan with all zone labels;
3. séjour/cuisine;
4. balcony and balcony doors;
5. Chambre 1 plus salle d’eau;
6. Chambres 2 and 3;
7. bathrooms/technical;
8. final plan and official area table.

Retain the demo’s view-offset composition, roof-arc transitions, projected pins, chapter rail, reduced-motion branch, and conventional final document.

---

# 6. Risks and fallbacks

| Risk | Impact | Fallback/mitigation |
|---|---|---|
| Missing Meshopt decoder | GLB geometry fails to load | Always call `setMeshoptDecoder()` |
| Missing KTX2 loader/transcoder | All 36 textures fail | Self-host Basis JS/WASM and call `detectSupport()` after renderer init |
| Mixed three.js versions | Constructor identity and TSL incompatibilities | Pin all core, WebGPU, TSL, and addons to `0.185.1` |
| TSL API churn | r185-specific code breaks on upgrade | Freeze version; upgrade only with visual/regression tests |
| `packNormalToRGB` rename | Older snippets use `directionToColor` | Use r185 `packNormalToRGB` / `unpackRGBToNormal` |
| SSGI output API changed | Older code assumes RGBA GI/AO texture | r185 requires `getAONode()` and `getGINode()` |
| `RenderPipeline`/SSGI on fallback backend | Black or invalid output | Check actual backend; direct-render on WebGL2 |
| `navigator.gpu` gives false confidence | Adapter failure may still yield WebGL fallback | Inspect `renderer.backend` |
| Double-sided NodeMaterial in MRT | WebGPU validation failure | Use `FrontSide`; duplicate/rotate geometry when necessary |
| Empty position buffers | Can invalidate the WebGPU command encoder | Skip draws with missing or zero-count `position` |
| Runtime `castShadow` changes | Potential stale node/shadow cache | Keep light `castShadow` fixed; toggle `renderer.shadowMap.enabled` |
| Custom merged outline internals | Fragile across releases and expensive | Omit for listing; use zone tint and ink |
| SSGI/denoise thermal cost | Mobile throttling | DPR cap, reduced steps, or disable AO |
| Odd-sized future KTX2 images | Invalid WebGPU block-compressed upload | Port Pascal’s RGBA32 alignment-safe loader |
| Full scene bbox includes site | Camera frames too far away | Fit `building` subtree only |
| No GLB spawn node | Walkthrough starts outside apartment | Supply an explicit runtime start pose |
| Zone areas disagree with official data | Misleading listing claims | Display official numbers; polygons remain interaction-only |
| Demo GLB normalization | Would destroy coordinate mapping | Never rescale/recenter this asset |
| Arithmetic-mean labels in concave zones | Label can be visually off-center | Use polygon centroid/polylabel |
| First render before renderer/KTX setup | KTX2 loader throws or flashes missing textures | Await renderer init and KTX support before loading GLB |
| WebGPU device loss | Canvas cannot recover reliably | Show static fallback and request page reload |

---

# 7. Recommended first implementation boundary

The lowest-risk version should ship in this order:

1. Exact r185.1 self-hosting and import map.
2. WebGPURenderer with verified WebGL2 fallback.
3. KTX2 + Meshopt GLB loading.
4. Building-subtree framing with the demo’s scroll camera interpolation.
5. Studio lighting, fitted shadows, and procedural environment.
6. Zone geometry and projected labels.
7. Screen-space ink.
8. Desktop-only SSGI AO and denoise.
9. Optional walkthrough loaded on demand.
10. Selection outline only if the final UX genuinely needs object selection.

The asset is already well prepared for this architecture: metre-scale coordinates are intact, Pascal identities survive in `extras`, zones carry polygons and labels, furniture is included, and all resources are embedded. The main data caveat is the area discrepancy; the main rendering caveat is that the strongest Pascal effects rely on unstable r185 TSL/WebGPU internals.