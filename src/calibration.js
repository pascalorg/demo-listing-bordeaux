import { Vector3 } from 'three/webgpu';
import { PHOTO_CAMS } from './config.js';

export function mountCalibration({ id, stage, viewer, story, i18n }) {
  const source = PHOTO_CAMS[id];
  if (!source) {
    console.warn(`Unknown calibration camera: ${id}`);
    return () => {};
  }
  const pose = {
    eye: [...source.eye],
    tgt: [...source.tgt],
    fov: source.fov,
  };
  const overlay = document.createElement('div');
  overlay.className = 'calibration-overlay';
  overlay.id = 'calibration-overlay';
  const image = document.createElement('img');
  image.src = source.photo;
  image.alt = '';
  const badge = document.createElement('p');
  const rebuild = () => {
    badge.textContent = `${i18n.t('ui.calibration')} · ${id} · ${i18n.t('ui.calibrationCopy')}`;
  };
  rebuild();
  overlay.append(image, badge);
  const requestedView = new URLSearchParams(location.search).get('calibView');
  const view = ['blend', 'model', 'photo'].includes(requestedView) ? requestedView : 'blend';
  overlay.dataset.view = view;
  overlay.classList.toggle('is-evidence', Boolean(requestedView));
  stage.append(overlay);
  document.body.classList.add('calibration-active');
  document.body.classList.toggle('calibration-photo', view === 'photo');
  story.setSuspended(true);
  viewer.zones.setMode('off');
  viewer.zones.setSuppressed(true);

  function apply() {
    viewer.camera.position.fromArray(pose.eye);
    viewer.camera.fov = pose.fov;
    viewer.camera.clearViewOffset();
    viewer.camera.lookAt(new Vector3(...pose.tgt));
    viewer.camera.updateProjectionMatrix();
    viewer.invalidate();
    viewer.render(true);
  }

  function keydown(event) {
    const key = event.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'q', 'e', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', '[', ']', 'c'].includes(key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 0.01 : 0.08;
    const eye = new Vector3(...pose.eye);
    const target = new Vector3(...pose.tgt);
    const forward = target.clone().sub(eye).setY(0).normalize();
    const right = new Vector3(-forward.z, 0, forward.x);
    if (key === 'w') eye.addScaledVector(forward, amount);
    if (key === 's') eye.addScaledVector(forward, -amount);
    if (key === 'a') eye.addScaledVector(right, -amount);
    if (key === 'd') eye.addScaledVector(right, amount);
    if (key === 'q') eye.y -= amount;
    if (key === 'e') eye.y += amount;
    if (key === 'arrowleft') target.addScaledVector(right, -amount);
    if (key === 'arrowright') target.addScaledVector(right, amount);
    if (key === 'arrowup') target.y += amount;
    if (key === 'arrowdown') target.y -= amount;
    if (key === '[') pose.fov = Math.max(20, pose.fov - (event.shiftKey ? 0.2 : 1));
    if (key === ']') pose.fov = Math.min(100, pose.fov + (event.shiftKey ? 0.2 : 1));
    pose.eye = eye.toArray().map((value) => Number(value.toFixed(3)));
    pose.tgt = target.toArray().map((value) => Number(value.toFixed(3)));
    if (key === 'c') {
      const text = JSON.stringify({ eye: pose.eye, tgt: pose.tgt, fov: Number(pose.fov.toFixed(1)) });
      console.info(`[PHOTO_CAMS.${id}] ${text}`);
      navigator.clipboard?.writeText(text).catch(() => {});
    }
    apply();
  }

  window.addEventListener('keydown', keydown);
  const unsubscribeLanguage = i18n.subscribe(rebuild);
  apply();
  return () => {
    window.removeEventListener('keydown', keydown);
    unsubscribeLanguage();
    document.body.classList.remove('calibration-active');
    document.body.classList.remove('calibration-photo');
    story.setSuspended(false);
    viewer.zones.setSuppressed(false);
    overlay.remove();
  };
}
