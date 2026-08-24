export const assetUrl = (path) => `${import.meta.env?.BASE_URL ?? '/'}${String(path).replace(/^\//, '')}`;

export const MODEL_URL = assetUrl('assets/model/apartment.glb');
export const LAYOUT_URL = assetUrl('assets/data/layout.json');
export const KTX2_PATH = assetUrl('basis/');
export const BUILDING_ID = 'building_rghsy6udcgia7kij';

export const LAYERS = Object.freeze({
  scene: 0,
  overlay: 1,
  zone: 2,
  grid: 3,
  shadowOnly: 4,
});

export const BUILDING_FALLBACK_BOUNDS = Object.freeze({
  min: [-10.355504, -0.000074, -5.150154],
  max: [-0.378002, 2.55, 8.550148],
});

// Hand-tunable photo viewpoints. Open `?calib=sejour`, `?calib=chambre1`, or `?calib=salledeau`
// in development to nudge these values over the matching photograph.
export const PHOTO_CAMS = Object.freeze({
  sejour: Object.freeze({
    id: 'sejour',
    photo: assetUrl('assets/photos/sejour.jpg'),
    eye: [-8.82, 1.8, -0.94],
    tgt: [-5.78, 0.5, -4.69],
    fov: 67.57,
  }),
  chambre1: Object.freeze({
    id: 'chambre1',
    photo: assetUrl('assets/photos/chambre-1a.jpg'),
    eye: [-6.17, 0.88, 7.3],
    tgt: [-1.53, 0.7, 5.44],
    fov: 70.24,
  }),
  salledeau: Object.freeze({
    id: 'salledeau',
    photo: assetUrl('assets/photos/salle-deau.jpg'),
    eye: [-7.16, 1.6, 6.55],
    tgt: [-11.54, 0.58, 8.73],
    fov: 77.86,
  }),
});

export const FEATURE_MOUNTS = Object.freeze({
  staging: { module: './features/staging.js', phase: 2 },
  sun: { module: './features/sun.js', phase: 2 },
  plan: { module: './features/plan.js', phase: 2 },
  walkthrough: { module: './features/walkthrough.js', phase: 2 },
});

export const OFFICIAL_AREAS = Object.freeze({
  'Entrée': 7.6,
  'Séjour / Cuisine': 33.3,
  'Chambre 1': 17.4,
  "Salle d'eau": null,
  'Chambre 2': 10.5,
  'Chambre 3': 9.4,
  'Salle de Bains': 4.8,
  'WC': 1.5,
  'Balcon': 8,
});

export const ZONE_KEYS = Object.freeze({
  'Entrée': 'entree',
  'Séjour / Cuisine': 'sejour',
  'Chambre 1': 'chambre1',
  "Salle d'eau": 'salleDeau',
  'Chambre 2': 'chambre2',
  'Chambre 3': 'chambre3',
  'Salle de Bains': 'salleDeBains',
  'WC': 'wc',
  'Balcon': 'balcon',
});
