```js
export const PHOTO_CAMS = Object.freeze({
  sejour: Object.freeze({
    id: 'sejour',
    photo: '/assets/photos/sejour.jpg',
    eye: [-9.6, 1.35, -1.9],
    tgt: [-3.4, 0.95, -3.1],
    fov: 72,
  }),
  chambre1: Object.freeze({
    id: 'chambre1',
    photo: '/assets/photos/chambre-1a.jpg',
    eye: [-6.05, 1.4, 5.2],
    tgt: [-3.2, 1.0, 7.25],
    fov: 70,
  }),
});
```

Only `PHOTO_CAMS` in `src/config.js` was changed.

- Six calibration frames regenerated successfully.
- Calibration: 0 console errors, 0 page errors.
- Quick full-load check: HTTP 200, model ready, 0 console errors, 0 page errors.