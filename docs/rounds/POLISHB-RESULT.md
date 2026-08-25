# POLISH-B result

## Result

The plan beat now has an unclamped azimuth and a `0.06–1.38 rad` polar range, from near top-down to a comfortable low orbit. Plan room clicks retain the existing eased fly-to/return flow; the six supplied poses are mapped to `chambre2`, `entree`, `salleDeau`, `wc`, `salleDeBains`, and `chambre3`, all at FOV 48. Existing Séjour, Chambre 1, and Balcon cameras are unchanged.

Walkthrough entry requests pointer lock synchronously at the start of the `VISITER LIBREMENT` click handler, before its first await. Rejection leaves the existing click-to-lock fallback available; Escape/unlock and the `P` pause remain graceful.

While locked, a 2.5 m screen-centre ray resolves only the nearest animatable GLB door. The Pascal-style reticle and key-pill HUD expose click/`E` interaction, and the door controller evaluates a short quintic-eased, time-driven toggle in either direction.

Walkthrough door state reconciles by snapshotting every door's story-consistent progress on entry and restoring those exact paused clip times before story rendering resumes on exit.

Ported Pascal techniques: direct pointer lock from the walkthrough gesture, nearest-hit centre ray targeting, stateful reticle/action pill, click/`E` toggles, and compact keyboard-control pills.

## Lean evidence

- `bun run build` — passed.
- Low plan orbit (`polar=1.38 rad`): `scratchpad/verify/polishb-plan-low-angle.png`
- Entrée exact pose `[-12.76, 5.43, 7.59] → [-9.44, 2.39, 5.42]`, FOV 48: `scratchpad/verify/polishb-plan-entree.png`
- WC exact pose `[-9.36, 2.99, 5.98] → [-10.46, -1.08, 8.67]`, FOV 48: `scratchpad/verify/polishb-plan-wc.png`
- Door-centred affordance: `scratchpad/verify/polishb-walkthrough-door-focus.png`
- Same door at progress `0.363`, moving/opening after click: `scratchpad/verify/polishb-walkthrough-door-mid-open.png`
- Machine report: `scratchpad/verify/polishb-report.json` — direct request observed with `userActivation=true` before walkthrough activation; all pre/post door progress values match; settled render count `527 → 527`; zero console/page errors on forced WebGL2.
