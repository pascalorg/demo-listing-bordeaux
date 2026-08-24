import { COPY_SHARED } from '../copy.js';

// Chevron/cross drawn as SVG rather than typographic glyphs: '‹ › ×' sit wherever the
// resolved serif puts them inside the em box (measured ~10px low in Iowan Old Style),
// so they can never be reliably centred in a round button. These paths are symmetric
// about the 24x24 viewBox centre, which flex centring then places exactly.
const ICONS = {
  previous: 'M15.5 4 8.5 12l7 8',
  next: 'M8.5 4 15.5 12l-7 8',
  close: 'M6 6l12 12M18 6 6 18',
};

function iconMarkup(name) {
  return `<svg class="lightbox-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
    + `<path d="${ICONS[name]}" fill="none" stroke="currentColor" stroke-width="1.75"`
    + ` stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function mountLightbox({ i18n, story, gallery }) {
  const root = document.createElement('div');
  root.className = 'lightbox';
  root.id = 'lightbox';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const scrim = document.createElement('button');
  scrim.type = 'button';
  scrim.className = 'lightbox-scrim';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lightbox-close';
  close.innerHTML = iconMarkup('close');
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'lightbox-arrow lightbox-previous';
  previous.innerHTML = iconMarkup('previous');
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'lightbox-arrow lightbox-next';
  next.innerHTML = iconMarkup('next');
  const frame = document.createElement('figure');
  frame.className = 'lightbox-frame';
  const image = document.createElement('img');
  image.decoding = 'async';
  const caption = document.createElement('figcaption');
  const captionText = document.createElement('span');
  const visit = document.createElement('button');
  visit.type = 'button';
  visit.className = 'story-photo-link lightbox-story-link';
  caption.append(captionText, visit);
  frame.append(image, caption);
  root.append(scrim, close, previous, frame, next);
  document.body.append(root);

  let items = [];
  let current = 0;
  let pointerStart = null;

  function makeItems() {
    const copy = i18n.dictionary().document;
    return [
      ...COPY_SHARED.galleryGroups.flatMap((group) => {
        const room = copy.galleryGroups[group.id].room;
        const photos = group.photos.map((item) => ({
          ...item,
          beat: group.beat,
          group: group.id,
          label: copy.gallery[item.key],
          caption: `${room} · ${copy.gallery[item.key]} · ${copy.galleryTypes[item.type || 'photo']}`,
          kind: 'photo',
          type: item.type || 'photo',
        }));
        const renders = group.renders.map((item) => ({
          ...item,
          beat: group.beat,
          group: group.id,
          label: i18n.t(`ui.renderStyles.${item.style}`),
          caption: `${room} · ${i18n.t(`ui.renderStyles.${item.style}`)} · ${copy.galleryTypes.projection}`,
          kind: 'projection',
        }));
        return [...photos, ...renders];
      }),
      ...COPY_SHARED.energyChartPaths.map(([key, source]) => ({
        key, source, beat: null, caption: copy.energy[key].chart, kind: 'energy-chart',
      })),
    ];
  }

  function goToStory(beat) {
    const index = story.beats.findIndex((candidate) => candidate.id === beat);
    if (index < 0) return;
    closeLightbox();
    story.goToBeat(index);
  }

  function thumbnail(item, index) {
    const figure = document.createElement('figure');
    figure.className = `gallery-card gallery-card-${item.kind}`;
    if (item.lead) figure.classList.add('gallery-card-lead');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'lightbox-trigger';
    trigger.setAttribute('aria-label', item.caption);
    const thumb = document.createElement('img');
    thumb.src = item.source;
    thumb.alt = item.caption;
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    trigger.append(thumb);
    if (item.kind === 'projection') {
      const badge = document.createElement('span');
      badge.className = `media-badge ${item.kind}-badge`;
      badge.textContent = i18n.dictionary().document.galleryTypes[item.kind];
      trigger.append(badge);
    }
    trigger.addEventListener('click', () => open(index));
    const figcaption = document.createElement('figcaption');
    const label = document.createElement('span');
    label.textContent = item.label || item.caption;
    figcaption.append(label);
    const type = document.createElement('span');
    type.className = 'gallery-card-type';
    type.textContent = i18n.dictionary().document.galleryTypes[item.type || item.kind];
    figcaption.append(type);
    figure.append(trigger, figcaption);
    return figure;
  }

  function galleryGroup(group, galleryItems, startIndex) {
    const copy = i18n.dictionary().document;
    const groupCopy = copy.galleryGroups[group.id];
    const section = document.createElement('section');
    section.className = 'gallery-room';
    section.dataset.room = group.id;

    const header = document.createElement('header');
    header.className = 'gallery-room-header';
    const title = document.createElement('h3');
    title.textContent = groupCopy.room;
    const area = document.createElement('span');
    area.className = 'gallery-area-chip';
    area.textContent = groupCopy.area;
    header.append(title, area);
    if (group.beat) {
      const link = document.createElement('a');
      link.href = `#${group.beat}`;
      link.className = 'story-photo-link gallery-story-link';
      link.textContent = i18n.t('ui.viewInStory');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        goToStory(group.beat);
      });
      header.append(link);
    }
    section.append(header);

    let itemOffset = 0;
    const appendRow = (kind, rowItems) => {
      if (!rowItems.length) return;
      const row = document.createElement('div');
      row.className = `gallery-row gallery-row-${kind}`;
      const rowLabel = document.createElement('p');
      rowLabel.className = 'gallery-row-label';
      rowLabel.textContent = copy.galleryRows[kind];
      const track = document.createElement('div');
      track.className = 'gallery-row-track';
      track.dataset.count = String(rowItems.length);
      rowItems.forEach((item) => {
        track.append(thumbnail(item, startIndex + itemOffset));
        itemOffset += 1;
      });
      row.append(rowLabel, track);
      section.append(row);
    };

    const photos = galleryItems.filter((item) => item.group === group.id && item.kind === 'photo');
    const projections = galleryItems.filter((item) => item.group === group.id && item.kind === 'projection');
    appendRow('photo', photos);
    appendRow('projection', projections);
    return section;
  }

  function paint() {
    const item = items[current];
    if (!item) return;
    image.src = item.source;
    image.alt = item.caption;
    captionText.textContent = item.caption;
    visit.hidden = !item.beat;
    visit.textContent = i18n.t('ui.viewInStory');
    visit.dataset.beat = item.beat || '';
  }

  function open(index) {
    current = index;
    paint();
    root.hidden = false;
    document.body.classList.add('lightbox-open');
    requestAnimationFrame(() => close.focus({ preventScroll: true }));
  }

  function closeLightbox() {
    if (root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('lightbox-open');
  }

  function move(direction) {
    current = (current + direction + items.length) % items.length;
    paint();
  }

  function rebuild() {
    items = makeItems();
    const galleryLength = COPY_SHARED.galleryGroups.reduce((total, group) => (
      total + group.photos.length + group.renders.length
    ), 0);
    const galleryItems = items.slice(0, galleryLength);
    let startIndex = 0;
    gallery.replaceChildren(...COPY_SHARED.galleryGroups.map((group) => {
      const section = galleryGroup(group, galleryItems, startIndex);
      startIndex += group.photos.length + group.renders.length;
      return section;
    }));
    close.setAttribute('aria-label', i18n.t('ui.lightboxClose'));
    scrim.setAttribute('aria-label', i18n.t('ui.lightboxClose'));
    previous.setAttribute('aria-label', i18n.t('ui.lightboxPrevious'));
    next.setAttribute('aria-label', i18n.t('ui.lightboxNext'));
    if (!root.hidden) paint();
  }

  close.addEventListener('click', closeLightbox);
  scrim.addEventListener('click', closeLightbox);
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  visit.addEventListener('click', () => goToStory(visit.dataset.beat));
  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    pointerStart = { x: event.clientX, y: event.clientY };
  });
  root.addEventListener('pointerup', (event) => {
    if (!pointerStart || event.pointerType !== 'touch') return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? -1 : 1);
  });
  const keydown = (event) => {
    if (root.hidden) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') move(-1);
    if (event.key === 'ArrowRight') move(1);
  };
  window.addEventListener('keydown', keydown);
  rebuild();
  const unsubscribe = i18n.subscribe(rebuild);

  return {
    open,
    openEnergyChart(key = 'dpe') {
      const index = items.findIndex((item) => item.kind === 'energy-chart' && item.key === key);
      if (index >= 0) open(index);
    },
    close: closeLightbox,
    destroy() {
      unsubscribe();
      window.removeEventListener('keydown', keydown);
      document.body.classList.remove('lightbox-open');
      root.remove();
    },
  };
}
