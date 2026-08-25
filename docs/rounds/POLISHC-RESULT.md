# POLISH C — lightbox arrows · browser language · contact CTA

`bun run build` → **pass**, 40 modules, `dist/assets/index-*.js` 278.55 kB / `index-*.css` 34.59 kB, built in <1 s.
Verification run: zero console errors and zero page errors across all 8 page loads.

Harness: `scripts/polishc-verify.mjs` (probe: `scripts/polishc-probe.mjs`), run against my own
`vite dev` on **:5199** (never 5180). Screenshots in `scratchpad/verify/polishc-*.png`.

## 1. Lightbox arrows now centred

Root cause was not CSS alignment but the glyphs themselves: `‹ › ×` were rendered as text, and
their ink sits wherever the resolved font puts it inside the em box. In `Iowan Old Style`
(first font in `--serif`) the guillemet ink spans 2.2–17.9 px *above* the baseline, so it landed
**≈9.8 px below** the button centre in a 52 px circle — ~19 % of the button. Flex + `line-height: 1`
alone would only have brought that to ≈4.9 px, and the residual is font-dependent, so it would
differ again on Windows/Android (`Times New Roman` / generic serif).

Fix: draw the chevrons and the close cross as inline SVG paths that are symmetric about the
24×24 viewBox centre (`src/features/lightbox.js`), and flex-centre the buttons. Centring is now
font-independent. Ink size was matched to the old glyphs (16.5 × 8 px chevron, 12.5 px cross) so
the visual weight is unchanged.

Measured ink-centre offset from button centre (px, pixel analysis of element screenshots @2×):

| | before (desktop) | after desktop 1440×900 | after mobile 390×844 |
|---|---|---|---|
| `‹` prev | +9.75 | **−0.25** | **−0.25** |
| `›` next | +9.75 | **−0.25** | **−0.25** |
| `×` close | +2.50 | **−0.25** | **−0.25** |

Horizontal offsets ≤0.5 px. −0.25 px is the antialiasing floor of the round line caps.

Evidence: `polishc-probe-prev.png` / `polishc-probe-close.png` (before),
`polishc-arrows-{desktop,mobile}-{prev,next,close}.png` and
`polishc-lightbox-{desktop,mobile}.png` (after).

## 2. Default language from the browser

`src/i18n.js` previously did `localStorage.getItem(KEY) === 'en' ? 'en' : 'fr'` — FR for everyone
without a stored choice. Now: `storedLanguage() ?? browserLanguage()`, where `browserLanguage()`
returns `fr` if any `navigator.languages` entry (falling back to `navigator.language`) lower-cases
to a `fr`-prefixed tag, else `en`. A persisted choice always wins and the toggle still writes it;
`localStorage` reads/writes are now try/caught so private-mode browsers fall back to the browser
preference instead of throwing. Toggle behaviour is otherwise untouched.

Checked with Playwright contexts using a forced `locale` (which sets `Accept-Language` and
`navigator.languages`):

| navigator.languages | stored choice | resulting `<html lang>` |
|---|---|---|
| `fr-FR` | — | `fr` |
| `fr-CA` | — | `fr` |
| `en-US` | — | `en` |
| `de-DE` | — | `en` |
| `de-DE` | `fr` | `fr` |
| `fr-FR` | `en` | `en` |

## 3. Contact / visit CTA

New module `src/features/cta.js`, mounted from `src/main.js` (not `story.js`), appended as the
**last section of `main#document`** — after the Pascal block, immediately before the footer
(verified: `#document.lastElementChild.id === 'visite'`, next sibling is end of main). Mounted
before `createViewer()` so it still renders if WebGPU/WebGL2 fails.

Dark `#101716` plate, two-column editorial grid (serif display headline left, body + pill right,
bottom-aligned), acid `var(--acid)` pill button in the header `VISITER LIBREMENT` idiom; single
column and full-width button below 900 px.

Copy verified live from the DOM, FR and EN, driven by the new `cta` key in both dictionaries in
`src/copy.js`. FR uses the site's typographic apostrophe (`l’agence`) to match every other French
string in the file. Link: exact agency URL, `target="_blank"`, `rel="noopener"`; the decorative
`↗` is stripped from the `aria-label`, which appends "opens in a new tab".

Evidence: `polishc-cta-fr.png`, `polishc-cta-en.png`, `polishc-cta-mobile-fr.png`.

`SPEC.md` updated: branding exception block under the Pascal-first clause, new §6.6 describing the
CTA section and its copy, §7 footer renumbered, and the acceptance criteria amended (agency-identity
line + browser-default language).

## Files changed

- `src/features/cta.js` (new)
- `src/features/lightbox.js`
- `src/i18n.js`
- `src/main.js`
- `src/copy.js` (added `cta` block to `fr` and `en` only)
- `src/styles.css` (lightbox button centring + `.lightbox-icon`; CTA block appended at end of file)
- `SPEC.md`
- `scripts/polishc-verify.mjs`, `scripts/polishc-probe.mjs` (new harnesses)

`index.html` unchanged — the CTA section is built entirely in JS.
