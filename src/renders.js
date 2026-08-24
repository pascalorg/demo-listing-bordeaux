import { assetUrl } from './config.js';

export const SEJOUR_RENDER_STYLES = Object.freeze([
  Object.freeze({ id: 'bord-de-mer', source: assetUrl('assets/renders/sejour-bord-de-mer.webp') }),
  Object.freeze({ id: 'boheme', source: assetUrl('assets/renders/sejour-boheme.webp') }),
  Object.freeze({ id: 'scandinave', source: assetUrl('assets/renders/sejour-scandinave.webp') }),
]);

export const CHAMBRE1_RENDER_STYLES = Object.freeze([
  Object.freeze({ id: 'scandinave', source: assetUrl('assets/renders/chambre1-scandinave.webp') }),
  Object.freeze({ id: 'japandi', source: assetUrl('assets/renders/chambre1-japandi.webp') }),
  Object.freeze({ id: 'boheme', source: assetUrl('assets/renders/chambre1-boheme.webp') }),
  Object.freeze({ id: 'cosy', source: assetUrl('assets/renders/chambre1-cosy.webp') }),
]);

export function decodeImage(image, source) {
  image.src = source;
  if (typeof image.decode === 'function') return image.decode();
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
  });
}
