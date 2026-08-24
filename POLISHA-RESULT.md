# POLISH-A result

## Build

`bun run build` passed. The existing Vite chunk-size advisory remains non-fatal.

## Zone-label lifecycle

- [Floor labels — 7 px soft radius](scratchpad/verify/polisha-floor-labels-radius.png): eight visible labels at opacity `1`, each already using the final translucent plate, acid border, blur, and `7px` radius.
- [Floor → séjour, t = 0.35](scratchpad/verify/polisha-floor-sejour-t035-label-fade.png): visible labels are partially faded at opacity `0.55348`, still with the final `7px` treatment; no visible labels remain at `t = 0.50`.
- Fade-out is story-progress mapped: it begins at transition `t = 0.22`, uses a smoothstep opacity fade, and reaches exactly zero at `t = 0.50`. Reverse travel uses the same curve, while discontinuous/reduced-motion jumps use a 240 ms wall-clock fade.

Root cause — unstyled flash: labels were created with a different `2px` base plate while the finished pill treatment and forced full opacity lived only under the later parent floor-mode class; threshold/collision changes also toggled `hidden`, bypassing opacity fades.

Fix — final-first-frame styling: the complete plate now lives on `.zone-label` itself with a `7px` radius, and lifecycle/collision visibility is opacity-driven; `hidden` is applied only after opacity reaches zero.

## Sun control

- [08:00 — low warm dawn sun](scratchpad/verify/polisha-sun-08h.png)
- [13:00 — high acid midday sun](scratchpad/verify/polisha-sun-13h.png)
- [20:30 — low warm dusk sun](scratchpad/verify/polisha-sun-20h30.png)

The native range remains the interactive/focusable control; its transparent native thumb is overlaid by an inline SVG sun whose height, color, horizon treatment, and dusk/moon state follow the selected hour. The restrained track runs dawn → day → dusk. Keyboard proof: `ArrowRight` changed `20.50 → 20.75` and updated `aria-valuetext` to `8:45 PM`.

Root cause — unwanted rendering: autoplay advanced on every story frame through a 24 Hz cadence accumulator, reduced-motion branch, visibility clock, and response smoothing, repeatedly calling `setDaylight()`.

Fix — fully user-driven lighting: all autoplay, reduced-motion, visibility-clock, cadence, and smoothing machinery is removed; `setDaylight()` runs only from the range `input` event.

Untouched balcon idle proof: after the camera/convergence settled, `renderCount` stayed `23 → 23` for 1 second and the initial range remained `11.5`. WebGL2 fallback produced zero console/page errors. Machine values: [polisha-report.json](scratchpad/verify/polisha-report.json).

No dependency or scroll-feel constant/easing changed.
