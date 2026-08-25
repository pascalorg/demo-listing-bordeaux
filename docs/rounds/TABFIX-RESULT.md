Fixed and verified.

Root cause: the probe waited only for `.is-current`/`src` to change, then screenshotted immediately. At that instant the old photo still had opacity `1` and the Japandi buffer opacity `0`, so both backends deterministically captured the start of the dissolve—not a preload failure.

Changes:

- [story.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:141): guards async image commits against stale i18n-rebuilt cards and preserves the selected Chambre 1 style across rebuilds.
- [staging.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/staging.js:38): prevents pending staging decodes from committing after teardown.
- [verify.mjs](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:153): waits until the current image is fully opaque, other buffers are transparent, decoding is complete, and `currentSrc` matches the expected render before screenshotting. Applied to both staging and Chambre 1.

Verification:

- WebGPU: pass
- WebGL2: pass
- Staging source: `sejour-bord-de-mer.webp`
- Chambre 1 source: `chambre1-japandi.webp`
- Console errors: 0
- Page errors: 0
- Assertion failures: 0

Regenerated evidence:

- [WebGPU Japandi](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/renders-webgpu-chambre1-japandi.png)
- [WebGL2 Japandi](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/renders-webgl2-chambre1-japandi.png)
- [Full verification report](/Users/wawa/Documents/Projects/pascal/apartment-listing/VERIFY-RESULT.md)