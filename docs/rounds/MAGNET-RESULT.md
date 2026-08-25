Implemented scroll magnetism with a unified wheel-glide/settle authority in [story.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:551).

Evidence: [MAGNET-RESULT.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/MAGNET-RESULT.md)

Key results:

- +0.22 beats: exact landing in 766.7ms, 0% overshoot, monotonically decaying tail.
- +0.45 beats: 0px movement after 2 seconds.
- Mid-settle wheel: synchronous cancellation in 0.1ms, 0px post-cancel movement.
- Reduced-motion, document, browse, walkthrough, and staging exclusions implemented.
- [verify.mjs](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:549) extended with all three probes.
- `bun run build`: pass.
- WebGL2 verification and hardening: pass.
- Console errors: 0; page errors: 0.