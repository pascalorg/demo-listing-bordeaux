# SPEC — Listing Cenon · Pascal showcase

A scroll-driven, cinematic apartment listing built from a **Pascal capture** (real GLB + scene graph),
presenting a real T4 in Cenon (33150) as a "the model is the data" story.
Adapted from the Kastanjelaan demo (`/Users/wawa/Downloads/listing-cenon/listing-kastanjelaan-4b-story.html`)
but upgraded: real GLB instead of procedural geometry, WebGPU/TSL rendering with Pascal's look,
and the interactive plan, sun scrub, matched photo cards, embedded DPE/GES facts with lightbox,
dwell-paced story,
and pointer-lock walkthrough.

**Branding: Pascal-first.** No agency identity (no agency name in UI, no phone, no ref number).
Discreet data-provenance footnote only (see Footer). Tone: confident, precise, no estate-agent fluff.
The demo's voice ("measured, modelled, shown as the model itself") is the register to keep.

> **Exception (explicitly authorised by the user, 2026-08-24):** the closing contact/visit CTA
> (§6.6) links out to the agency listing page. It is the single sanctioned outbound agency link;
> it still carries no agency name, phone number, or reference in the UI, so the rest of the
> Pascal-first clause stands unchanged.

---

## 1. Tech constraints

- **Bun-managed project with Vite.** `package.json` + `bun.lock`, dependencies installed with bun
  (`three` pinned EXACT `0.185.1` — no caret). `bun run dev` (Vite dev server, HMR),
  `bun run build` (static `dist/` deployable anywhere), `bun run preview`. No framework, no React.
  Plain ES modules; imports resolve normally (`three/webgpu`, `three/tsl`,
  `three/addons/...`) — no importmap, no vendored copies.
- **three.js WebGPURenderer + TSL**. Automatic WebGL2 fallback (three's WebGPURenderer does this;
  verify the fallback path doesn't crash on the TSL used). KTX2 transcoder + meshopt decoder must
  work under both dev and build (put the basis transcoder files in `public/` and
  `setTranscoderPath` accordingly, or an equivalent Vite-clean approach).
- Rendering look ported from Pascal viewer source (see TECH_NOTES.md): post chain, edges/outline,
  lighting rig, environment/backdrop, zone rendering. Copy techniques, not the package.
- Performance: render-on-demand where possible (demo used `dirty` flag); cap DPR at 2; the GLB is 3.7 MB.
- Works in Chrome (WebGPU) and Safari/Firefox (WebGL2 fallback). Graceful reduced-motion support
  (keep the demo's `prefers-reduced-motion` behaviour).
- Mobile: story must scroll and read; 3D interaction can be reduced (keep demo's touch behaviour).

## 2. Project layout (this directory)

```
package.json                  # bun-managed; three pinned exact 0.185.1; vite devDependency
bun.lock
vite.config.js                # minimal; ensure .glb/.ktx2/.wasm assets handled
index.html                    # Vite entry
README.md                     # how to run (bun install / bun run dev / build), shipped asset list
src/*.js                      # ES modules (viewer, beats, i18n, features)
public/assets/model/apartment.glb    # copy of 'lod0 (9).glb'
public/assets/data/layout.json       # copy of layout_2026-08-20.json
public/assets/photos/*.jpg           # downscaled (max 1920px, q~80) via sips, semantic names below
public/assets/photos/plan-officiel.webp
public/assets/diagnostics/{dpe,dpe-ges}.jpeg
public/assets/renders/*.webp          # seven shipped 1920px staging renders
public/basis/...                     # KTX2 transcoder files if needed for setTranscoderPath
```

Photo mapping (source `/Users/wawa/Downloads/listing-cenon/photos/`, photo-8 is a byte-identical
duplicate of photo-7 — skip it):

| source | semantic name | room |
|---|---|---|
| photo-3 | `sejour.jpg` | Séjour (white sofa, tiled floor, balcony door) |
| photo-4 | `cuisine.jpg` | Cuisine ouverte (black units, gold pendants) |
| photo-2 | `balcon.jpg` | Balcon (decking, mesh railing, sky) |
| photo-6 | `chambre-1a.jpg` | Chambre 1 / suite (teal wall, pink chandelier) |
| photo-7 | `chambre-1b.jpg` | Chambre 1, second angle |
| photo-1 | `chambre-2.jpg` | Chambre 2 (pale blue wall) — mapping to confirm, could be Ch. 3 |
| photo-5 | `salle-deau.jpg` | Salle d'eau (walk-in shower) |
| photo-9 | `salle-de-bains.jpg` | Salle de bains (bathtub) |

## 3. Listing data (source of truth)

Real listing (public): latresne-immobilier.com, "CENON – Appartement familial 4 pièces au dernier
étage, proche tram et commodités". Use the FACTS, not the agency identity.

- Prix : **316 500 €** → **3 746 €/m²**
- **T4 · 84,50 m²** habitables · 3 chambres
- **3e et dernier étage**, ascenseur · résidence **2018** (résidence "Confluence", bât. B2, lot B2 306 — do not show lot number in UI)
- **Balcon 8,00 m²**
- Proche : tram (à pied), gare, commerces, écoles — Cenon bas, rive droite de Bordeaux
- Surfaces officielles (plan promoteur, shown in `plan-officiel.webp`):
  Entrée 7,60 · Séjour+Cuisine 33,30 · Chambre 1 + salle d'eau 17,40 · Chambre 2 10,50 ·
  Chambre 3 9,40 · Salle de bains 4,80 · WC 1,50 → **84,50 m²** · Balcon 8,00
- DPE **A — 48 kWhEP/m²/an** · GES **C — 11 kgéqCO₂/m²/an**. These values are embedded in
  the figures grid. Each badge opens its corresponding official chart from
  `public/assets/diagnostics/` in the shared lightbox; there is no standalone Diagnostics section.
- One parking space.

The scene graph (`assets/data/layout.json`) has 9 zones: Entrée, Séjour / Cuisine, Chambre 1,
Chambre 2, Chambre 3, Salle de Bains, Salle d'eau, WC, Balcon — with polygons. **Important
(recon finding):** zone polygons are gross/centerline footprints, ~+27% vs official net areas.
Therefore: official areas in ALL visible copy and tables; polygons ONLY for interaction (plan SVG
shapes, highlights, centroids, camera targets). Never display a polygon-derived m² number.
Zone name → official area mapping for labels: Entrée 7,60 · Séjour / Cuisine 33,30 ·
Chambre 1 17,40 (avec salle d'eau) · Salle d'eau (comprise dans Chambre 1, no number) ·
Chambre 2 10,50 · Chambre 3 9,40 · Salle de Bains 4,80 · WC 1,50 · Balcon 8,00.
Note: the GLB itself carries `extras.{pascalId, kind, label, polygon, color}` per zone — prefer it
as the runtime source; the JSON stays for openings/fences metadata (see TECH_NOTES.md §3).

## 4. Story structure (beats)

Keep the demo's mechanics: full-viewport sticky stage, one viewport of scroll per beat, eased
camera interpolation between beats, copy cards placed per-beat, pin layer projecting 3D points,
nav rail, scroll cue, mouse-drag yaw/pitch look, style/tone shifts. Smoothed beat progress is remapped
through `f(t) = t − 0.90·sin(2πt)/(2π)`: velocity falls to 10% at beat centres without ever stopping
and rises between beats. Camera, copy, and pins use the same remapped progress. Discrete mouse-wheel
deltas add velocity to one physical scroll authority and coast under exponential friction; there is
no idle settle, snap, or other unprompted page motion. Trackpads, keyboard, scrollbar, deep-links,
the supporting document, and reduced-motion retain native/direct scrolling.

1. **hero** — slow orbit, whole apartment (shell visible, slight top angle).
2. **floor** — higher orbit / dollhouse view, zone labels only (no tint fills or border quads).
3. **sejour** — interior camera in Séjour/Cuisine. Pins: porte-fenêtre → balcon, cuisine ouverte.
4. **staging** — same room, camera eases to the *photo-matched* viewpoint (see §5 Staging).
5. **balcon** — camera on/near balcony looking along it + **sun scrub** UI (see §5).
6. **chambre1** — photo-matched interior camera + right-side thumbnail card with `chambre-1a.jpg`
   and four decoded, cross-dissolving staging styles.
7. **salledeau** — transition through the pocket door into the en-suite + matched thumbnail card
   with `salle-deau.jpg`; the authored pocket-door open clip plays on approach.
8. **chambres** — camera framing Chambres 2 & 3 side of the plan (cutaway/orbit), pins on both.
9. **plan** — top-down view whose world X/Z screen mapping exactly matches the SVG plan
   (balcony right, living room top-left, Bedroom 1 bottom) + **interactive floor plan** panel (§5).
Then (normal document flow below the story): details/docs section + CTA + footer (§6).

### Beat copy (FR primary / EN toggle)

Registers: FR is the voice; EN mirrors it, not literal translation. `price` and `figs` chips as in demo.

**hero**
- k: `À vendre · Cenon — rive droite, Bordeaux` / `For sale · Cenon — Bordeaux right bank`
- h: `Un 4 pièces lumineux au dernier étage.` / `A bright four-room flat on the top floor.`
- p: `84,50 m² au 3ᵉ et dernier étage d'une résidence de 2018 — DPE A, à quelques minutes du tram et de la gare. La visite se fait en volume : le modèle 3D que vous parcourez est le relevé de l'appartement.` /
  `84.50 m² on the third and top floor of a 2018 residence — DPE A, a few minutes from the tram and railway station. The visit unfolds in three dimensions: the 3D model you move through is the measured survey of the flat.`
- price: `316 500 € · 3 746 € / m²`
- figs also include `DPE A` and `Place de parking` / `Parking space`.

**floor**
- k: `Un niveau · 84,50 m²` / `One level · 84.50 m²`
- h: `Les pièces de vie d'un côté, les chambres au calme.` / `Living on one side, bedrooms in the quiet.`
- p: `L'entrée distribue tout : un séjour-cuisine de 33,30 m² ouvert sur le balcon, trois chambres, deux salles d'eau. Pas un mètre de couloir perdu.` /
  `The hall serves everything: a 33.30 m² living-kitchen opening onto the balcony, three bedrooms, two bathrooms. Not a metre of corridor wasted.`
- pins: room names + areas (zone centroids).

**sejour**
- k: `Séjour + cuisine · 33,30 m²` / `Living + kitchen · 33.30 m²`
- h: `La pièce où tout se passe.` / `The room where everything happens.`
- p: `Cuisine ouverte, lumière traversante, et la porte-fenêtre qui file sur le balcon. Ce que vous voyez est le mobilier du modèle — pas un décor.` /
  `Open kitchen, light straight through, and the door running out to the balcony. What you see is the model's own furniture — not set dressing.`
- pins: `Porte-fenêtre → balcon`, `Cuisine ouverte`.

**staging**
- k: `Projections d'aménagement` / `Interior proposals`
- h: `Le séjour, aujourd'hui et demain.` / `The living room, now and next.`
- p: `La photo actuelle d'abord, puis trois propositions d'aménagement — rendues depuis le même point de vue, dans le volume réel.` /
  `The current photograph first, followed by three furnishing proposals — rendered from the same viewpoint, within the measured space.`

**balcon**
- k: `Balcon · 8,00 m²` / `Balcony · 8.00 m²`
- h: `Le café au soleil du matin.` / `Morning coffee in the sun.`
- p: `Huit mètres carrés au-dessus des toits, exposés nord-est. Faites glisser l'heure pour voir la lumière tourner.` /
  `Eight square metres above the rooftops, facing north-east. Drag the time to watch the light move.`
- UI: sun scrub slider (see §5).

**chambre1**
- k: `Suite parentale · 17,40 m²` / `Main suite · 17.40 m²`
- h: `Une chambre avec sa salle d'eau à elle.` / `A bedroom with its own shower room.`
- p: `À l'écart du séjour : la chambre, puis sa salle d'eau privative. La photo est prise du même point de vue que le modèle.` /
  `Set apart from the living room: first the bedroom, then its private shower room. The photograph was taken from the same viewpoint as the model.`
- UI: right-side thumbnail card with `chambre-1a.jpg`, captioned `La chambre aujourd'hui — même point de vue`.

**salledeau**
- k: `Salle d'eau · suite parentale` / `Shower room · main suite`
- h: `La salle d'eau attenante.` / `The adjoining shower room.`
- p: `Douche, vasque et rangements — accessible depuis la chambre par une porte coulissante.` /
  `Shower, vanity and storage — reached from the bedroom through a pocket door.`
- UI: same thumbnail-card treatment using `salle-deau.jpg`.

**chambres**
- k: `Chambres 2 & 3 · 10,50 et 9,40 m²` / `Bedrooms 2 & 3 · 10.50 and 9.40 m²`
- h: `Deux chambres, deux usages.` / `Two bedrooms, two uses.`
- p: `La chambre 2 donne côté calme. La chambre 3, près du séjour et du balcon, fait une chambre d'enfant ou un bureau idéal.` /
  `Bedroom 2 faces the quiet side. Bedroom 3, close to the living room and balcony, makes an ideal child's room or home office.`
- pins on both rooms.

**plan**
- k: `Le plan` / `The plan`
- h: `Le plan, mais en volume.` / `The plan, but in volume.`
- p: `Survolez une pièce pour l'allumer dans le modèle ; cliquez pour y aller. Le plan est dessiné depuis le modèle Pascal, les surfaces sont celles de la fiche officielle.` /
  `Hover a room to light it up in the model; click to go there. The plan is drawn from the Pascal model; the areas are the official ones.`
- UI: interactive SVG plan (see §5).

## 5. Feature contracts

### i18n (FR default, EN toggle)
- Toggle `FR / EN` in the fixed header (top-right, near the nav rail works too). Persist in
  `localStorage`. All copy (beats, pins, UI labels, details section, README-visible strings) comes
  from a single dictionary module `src/copy.js` with `{fr, en}` — no hardcoded strings in logic.
- `<html lang>` updates; number formatting stays French-style in FR (`84,50 m²`) and English-style in EN.

### Interactive floor plan (beat `plan` + reusable)
- Draw a clean 2D plan as inline SVG from the layout JSON zone polygons (+ door/window marks if
  cheap from wall data). NOT the scanned developer plan.
- Each zone: filled shape, name + official m² label (never a polygon-derived area).
- Hover (or tap): highlight zone in the SVG **and** in the 3D model — use Pascal's zone-rendering
  technique (flat tinted floor polygon overlay) at the zone's location.
- Click: camera flies to that room's interior camera (reuse per-room cameras from beats when they
  exist, else a sensible auto-frame of the zone) — without breaking the scroll-story state machine
  (on click, story enters a "browse" pause like the demo's docMode; scrolling resumes the story).
- The same component persists as a glass-backed bottom-left mini-plan on desktop story beats and in
  walkthrough. It reuses the room fills/walls without labels and overlays the live camera X/Z point
  plus a horizontal-FOV cone derived from the projected camera direction. On mobile the mini-plan is
  hidden during the scroll story and shown smaller only in walkthrough. Clicking the desktop mini-plan
  expands the full interactive panel; browse mode reuses this component rather than adding a second map.

### Sun / daylight scrub (beat `balcon`)
- A horizontal slider (plus subtle time label, e.g. `9h — 21h`) driving time-of-day.
- Sun direction computed for Cenon (lat 44.857, lon −0.522) on a summer date, simple solar-position
  approximation is fine. Orientation assumption (document it as an assumption in README): the
  balcony sits on the building's +X edge (fences at X≈−0.4, see TECH_NOTES.md) → treat world +X as
  **north-east**. Morning sun reaches the balcony.
- Drives: directional light position/intensity/colour temperature, sky/background tint, shadow.
  Smoothly interpolated; scrubbing marks the frame dirty (no continuous render loop needed).
- Outside the balcon beat, time eases back to the default (late morning).

### Matched photo cards (`chambre1` and `salledeau`)
- Cameras ease to per-photo calibrated viewpoints in `PHOTO_CAMS` (`sejour`, `chambre1`, and
  `salledeau`) with `{ id, photo, eye:[x,y,z], tgt:[x,y,z], fov }`.
- The real photograph is shown as a rounded right-side thumbnail card, roughly half the desktop
  viewport wide and short enough to leave the surrounding model visible. Mobile stacks the photo
  safely above the copy sheet. There is no compare slider.
- The `chambre1` card adds `Photo`, `Scandinave`, `Japandi`, `Bohème`, and `Cosy` tabs. The four
  staging renders are shipped as 1920px WebPs; the inactive buffer is loaded and decoded before the
  card cross-dissolves.

### Staging sequence (beat `staging`) — "the photo develops over the model"
- Entering the beat: camera eases to the séjour `PHOTO_CAMS` viewpoint. When settled (or at a scroll
  progress threshold), the real photo (`sejour.jpg`) fades in full-bleed over the canvas (1–1.5 s
  dissolve — the model "becomes" reality). The 3D scene itself never changes.
- Then a horizontal row of style cards slides in (like the demo's render row): `Photo actuelle`,
  `Bord de mer`, `Bohème`, `Scandinave` (EN: `As it is`, `Coastal`, `Bohemian`, `Scandinavian`).
  The three 1920px WebPs are first-class bundled assets. The inactive image buffer is loaded and
  decoded before selecting a card cross-dissolves the full-bleed image.
- Scrolling past the beat fades the overlay back to live 3D.

### Pointer parallax and scroll feel
- Fine mouse pointers add an eased look offset over the stage (maximum 1.6° yaw / 1.0° pitch),
  additive with drag look. It marks the render dirty only while easing and is disabled in walkthrough,
  calibration, staging full-bleed, browse mode, and reduced-motion.
- Mouse drag adjusts authored framing on both axes at 0.0045 rad/px, clamped to ±0.90 rad yaw and
  ±0.45 rad pitch. Orbit and explicit-camera beats both compose these offsets with parallax. Once
  story position moves by more than 0.004 beats, both drag offsets ease to zero over 600 ms; pointer
  parallax and smaller scroll jitter do not trigger recentering.
- A discrete 100 px wheel delta adds 3.12 beats/s of velocity. Velocity decays exponentially at
  3.2 s⁻¹ down to a 1.5 px/s cutoff, with exact time-step integration and an independent fractional
  position accumulator. Further discrete input adds to the live velocity without resetting position;
  continuous pixel trackpad input takes native control immediately. A medium impulse travels about
  0.975 beats from rest, while harder impulses can pass the next section.
- The dwell remap numerically integrates `0.04 + 0.96 × |sin(πt)|^1.8` into a normalized 2,048-entry
  lookup. It is monotonic, preserves exact integer beat centers, and has a 4% center/mid velocity
  ratio. Camera-flight arcs are windowed to eased `[0.15, 0.85]` with zero contribution and derivative
  at beat centers; short and séjour→staging interior flights are heavily reduced. Reduced-motion
  bypasses both wheel inertia and dwell remapping.

### Walkthrough (free visit)
- Entry: button in the header (`Visiter librement` / `Walk through`) + a card in the CTA section.
- Desktop first-person mirrors the Pascal viewer: click the canvas to acquire pointer lock; mouse look
  sensitivity 0.002 rad/px; pitch clamp ±(π/2−0.05); 60° FOV; WASD/arrow locomotion at 2 m/s,
  Shift run at 5 m/s, acceleration 26 and deceleration 30. `P` deliberately releases/reacquires
  the pointer without leaving; an ordinary pointer-lock exit (Esc) leaves the walkthrough.
- Collision remains the listing's polygon/wall/door clamp and opens nearby authored doors.
- Mobile: virtual joystick optional — if not trivial, drag-to-look + tap-to-move-forward is enough.
- `Esc` / close button returns to the story exactly where it was. Story scroll is disabled while walking.

## 6. Details / docs section (below the story, normal scroll)

1. **Figures grid** (chips): price, €/m², 84,50 m², T4 · 3 chambres, étage 3/3 + ascenseur,
   balcon 8 m², 2018, `Place de parking`, `Tram & gare à pied`, `Commerces & écoles`, plus an
   embedded equal-size energy pair carrying `DPE A · 48 kWhEP/m²/an` and
   `GES C · 11 kgéqCO₂/m²/an` (EN: `/year`). Each energy badge opens its official chart in the
   shared lightbox. The grid must end in complete rows on desktop and mobile.
2. **Surfaces table**: the official areas only (per §3 mapping, total 84,50 m² + balcon 8,00),
   caption: FR `Surfaces habitables — fiche promoteur.` / EN `Habitable areas — developer's sheet.`
   No polygon-derived numbers (see §3).
3. **Gallery**: title `L'appartement en images.` / `The flat in pictures.`. Content is grouped in this
   order, with an editorial room header, official-area chip, a Photos row, and a visually distinct
   `Projections d'aménagement` / `Staging projections` row where renders exist:
   - `Séjour & cuisine · 33,30 m²`: `sejour.jpg` as the larger lead, `cuisine.jpg`, then the three
     séjour projections (Bord de mer, Bohème, Scandinave); tour link → `sejour`.
   - `Suite parentale · 17,40 m²`: `chambre-1a.jpg` as the larger lead, `chambre-1b.jpg`,
     `salle-deau.jpg`, then the four bedroom projections (Scandinave, Japandi, Bohème, Cosy); tour
     link → `chambre1`.
   - `Balcon · 8,00 m²`: `balcon.jpg`; tour link → `balcon`.
   - `Chambres 2 & 3 · 10,50 et 9,40 m²`: `chambre-2.jpg` captioned `Chambre 2`, followed in the
     same Photos row by `chambre3-ia.webp`, captioned `Chambre 3` and typed
     `Rendu généré par Pascal`; tour link → `chambres`.
   - `Salle de bains · 4,80 m²`: `salle-de-bains.jpg`; no tour link.
   Every projection thumbnail has a visible `Projection` tag. The dependency-free full-screen
   lightbox also serves the DPE/GES chart badges; arrows/swipe traverse the gallery in the grouped order,
   and gallery captions include room, item label, and media type. Room headers expose
   `Voir dans la visite →` / `See it in the tour →` links where a matching beat exists. On mobile,
   image rows become horizontal snap-scroll tracks without introducing page-level overflow.
4. **Plan officiel**: `plan-officiel.webp` shown small with a caption (proof, not hero).
5. **Pascal block (the pitch)**:
   - k/h: `Dossier vérifiable` / `Un dossier qui se visite.`
   - FR: `Cette annonce est construite sur un relevé 3D de l'appartement réalisé avec Pascal : les surfaces, les murs et les menuiseries que vous venez de parcourir sont mesurés. Le fichier 3D est téléchargeable ci-dessous — format .glb, lisible par la plupart des visionneuses 3D.`
   - Buttons: `Visiter librement` and `Télécharger le fichier 3D`, with `.glb · 3,7 Mo` hint.
6. **Contact / visit CTA** (`src/features/cta.js`, mounted from `main.js`, last section of
   `main#document`, before the footer): dark plate `#101716`, serif display headline, acid pill
   button in the header's `Visiter librement` idiom.
   - FR — k `La suite` / h `Envie de le voir en vrai ?` /
     p `Contactez l'agence pour organiser une visite — ou pour toute question sur le bien.` /
     button `Organiser une visite ↗`
   - EN — k `Next step` / h `Want to see it for real?` /
     p `Contact the agency to arrange a visit — or with any question about the property.` /
     button `Schedule a visit ↗`
   - The button is the page's only outbound link, to the agency listing URL, opened with
     `target="_blank" rel="noopener"` (see the branding exception at the top of this spec).
     Copy lives under the `cta` key in both dictionaries in `src/copy.js`.
7. **Footer**: `Démo Pascal — pascal.app` (or plain `Pascal`), plus discreet provenance:
   FR `Données issues d'une annonce publique.` / EN `Data from a public listing.` No agency name.

## 7. Look & feel

- Keep the demo's typographic confidence (big serif/display headline, small caps kickers, chips),
  but re-skin: Pascal-first palette, French typographic conventions in FR (narrow no-break spaces
  before `€` figures done as in copy above; don't over-engineer).
- The 3D look must feel like Pascal: ink edges/outline, soft AO, clean tonemapping, subtle
  background gradient (per TECH_NOTES.md port). This is the wow: "the editor's model, presented
  like a film".
- Dark-ish elegant UI or light — pick ONE and execute it well; match Pascal's viewer vibe.

## 8. Acceptance criteria

- `bun install && bun run dev` → `http://localhost:5173` runs with **zero console errors** in
  Chrome (WebGPU) — and loads with the WebGL2 fallback path (no TSL crash) when WebGPU is
  unavailable. `bun run build` succeeds and `bun run preview` serves an equally working site
  (KTX2/meshopt decoding included).
- All 9 beats scroll smoothly with positive-velocity dwell easing; nav rail works; deep-link `#beat-id` scrolls to beat.
- FR/EN toggle swaps every visible string, persists on reload. With no stored choice the initial
  language follows the browser: any `navigator.languages` tag starting with `fr` → FR, else EN.
- Floor plan: hover highlights zone in SVG + 3D; click flies camera; story resumes on scroll.
- Sun scrub visibly moves sun/shadows/sky on the balcon beat; frame is dirty-rendered.
- Bedroom and shower-room photo cards stay camera-matched and leave the model visible around them.
- Staging: photo develops over the model when aligned; the seven shipped WebP styles decode before
  their séjour/bedroom cross-dissolves and are included in the shared lightbox.
- Walkthrough pointer lock, P pause/reacquire, Shift run, and Esc exit work cleanly; no falling through floor.
- Reduced motion: no smooth scrolling/orbit drift; content fully readable.
- No agency identity anywhere, apart from the authorised outbound CTA link (§6.6). All seven
  staging renders are bundled production assets.
- Lighthouse-ish sanity: total transfer < 25 MB (photos downscaled), first paint not blocked by GLB
  (show stage backdrop + copy immediately, model fades in).

## 8bis. Authored animation tie-in

- The Chambre 1 pocket-door open clip plays during the transition into `salledeau`; the balcony
  French-door animation remains tied to the balcony approach.

## 9. Open item (user)

- Confirm photo-1 is Chambre 2 (not 3).
