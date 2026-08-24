import { assetUrl } from '../config.js';
import { decodeImage, SEJOUR_RENDER_STYLES } from '../renders.js';

export function mountStaging({ stage, i18n, story, viewer }) {
  const overlay = document.createElement('div');
  overlay.className = 'staging-overlay';
  overlay.id = 'staging-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  const images = [0, 1].map(() => {
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    overlay.append(image);
    return image;
  });
  const currentPhoto = assetUrl('assets/photos/sejour.jpg');
  images[0].src = currentPhoto;
  images[0].classList.add('is-current');
  stage.append(overlay);

  const picker = document.createElement('div');
  picker.className = 'staging-picker';
  picker.id = 'staging-picker';
  picker.setAttribute('aria-hidden', 'true');
  document.body.append(picker);

  const sources = {
    current: currentPhoto,
    ...Object.fromEntries(SEJOUR_RENDER_STYLES.map(({ id, source }) => [id, source])),
  };
  let visibleImage = 0;
  let selection = 'current';
  let pendingSelection = 0;
  let wasActive = false;
  let renderLockTimer = 0;
  let minimumOverlayElapsed = false;
  let renderLocked = false;
  let mounted = true;

  function syncRenderLock(active) {
    const shouldLock = active
      && minimumOverlayElapsed
      && viewer.convergenceFramesRemaining === 0;
    if (shouldLock === renderLocked) return;
    renderLocked = shouldLock;
    story.setRenderSuppressed('staging', renderLocked);
  }

  async function select(id) {
    if (!sources[id] || id === selection) return;
    const token = ++pendingSelection;
    const next = 1 - visibleImage;
    try {
      await decodeImage(images[next], sources[id]);
    } catch {
      return;
    }
    if (token !== pendingSelection || !mounted || !overlay.isConnected) return;
    selection = id;
    images[next].classList.add('is-current');
    images[visibleImage].classList.remove('is-current');
    visibleImage = next;
    picker.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.style === id));
    });
  }

  function rebuild() {
    const labels = [i18n.t('ui.currentPhoto'), ...SEJOUR_RENDER_STYLES.map(({ id }) => i18n.t(`ui.renderStyles.${id}`))];
    picker.replaceChildren(...['current', ...SEJOUR_RENDER_STYLES.map(({ id }) => id)].map((id, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.style = id;
      button.textContent = labels[index];
      button.setAttribute('aria-pressed', String(id === selection));
      button.addEventListener('click', () => select(id));
      return button;
    }));
  }

  function update(state) {
    const active = !state.docMode
      && Math.abs(state.targetValue - 3) < 0.18
      && state.value > 2.5
      && state.value < 3.55;
    if (active && !wasActive) {
      window.clearTimeout(renderLockTimer);
      minimumOverlayElapsed = false;
      renderLockTimer = window.setTimeout(() => {
        minimumOverlayElapsed = true;
        syncRenderLock(wasActive);
      }, 1_250);
    } else if (!active && wasActive) {
      window.clearTimeout(renderLockTimer);
      minimumOverlayElapsed = false;
    }
    wasActive = active;
    syncRenderLock(active);
    story.setLookLocked('staging', active);
    overlay.classList.toggle('is-active', active);
    picker.classList.toggle('is-active', active);
    overlay.setAttribute('aria-hidden', String(!active));
    picker.setAttribute('aria-hidden', String(!active));
  }

  rebuild();
  const unsubscribeLanguage = i18n.subscribe(rebuild);
  const unsubscribeFrame = story.subscribeFrame(update);
  return () => {
    mounted = false;
    pendingSelection += 1;
    unsubscribeLanguage();
    unsubscribeFrame();
    window.clearTimeout(renderLockTimer);
    if (renderLocked) story.setRenderSuppressed('staging', false);
    story.setLookLocked('staging', false);
    overlay.remove();
    picker.remove();
  };
}
