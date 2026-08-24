import { createI18n } from './i18n.js';
import { createStory } from './story.js';
import { createViewer } from './viewer.js';
import { mountCta } from './features/cta.js';
import { mountLightbox } from './features/lightbox.js';
import { mountPlan } from './features/plan.js';
import { mountStaging } from './features/staging.js';
import { mountSun } from './features/sun.js';
import { mountWalkthrough } from './features/walkthrough.js';

const i18n = createI18n();
i18n.apply();

const elements = {
  stage: document.querySelector('#stage'),
  canvas: document.querySelector('#viewer-canvas'),
  loadState: document.querySelector('#load-state'),
  fallback: document.querySelector('#viewer-fallback'),
  copyLayer: document.querySelector('#copy-layer'),
  pinLayer: document.querySelector('#pin-layer'),
  labelLayer: document.querySelector('#zone-label-layer'),
  rail: document.querySelector('#chapter-rail'),
  cueScrim: document.querySelector('#scroll-cue-scrim'),
  cue: document.querySelector('#scroll-cue'),
  track: document.querySelector('#story-track'),
};

const FACT_ICONS = [
  '<path d="M2.5 4.5 7 1.75l4.5 2.75v6L7 13.25 2.5 10.5Z"/><circle cx="7" cy="5" r="1"/>',
  null,
  '<path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9"/><path d="M4.5 7h5M7 4.5v5"/>',
  '<path d="M2 10.5V6.25h10v4.25M3.25 6.25V4h3.5v2.25M7.25 6.25V3.5h3.5v2.75M2 12h10"/>',
  '<rect x="3" y="2" width="8" height="10" rx="1"/><path d="m5 5 2-2 2 2M5 9l2 2 2-2"/>',
  '<path d="M2 3v8M12 3v8M2 7h10M4 7v4M10 7v4"/>',
  '<rect x="2.5" y="3.5" width="9" height="8" rx="1"/><path d="M4.5 1.75v3.5M9.5 1.75v3.5M2.5 6.25h9"/>',
  '<path d="m3 9 1-3h6l1 3M2 9h10v2H2Z"/><circle cx="4" cy="11.5" r=".75"/><circle cx="10" cy="11.5" r=".75"/>',
  '<rect x="2.25" y="2.5" width="9.5" height="7.5" rx="2"/><path d="M4 10v2M10 10v2M4.5 5.25h5M5 8h.01M9 8h.01"/>',
  '<path d="M7 13s4-3.75 4-7A4 4 0 0 0 3 6c0 3.25 4 7 4 7Z"/><path d="M5.5 6.25h3M7 4.75v3"/>',
];

function createFactIcon(index) {
  const paths = FACT_ICONS[index];
  if (!paths) return null;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('fact-icon');
  icon.setAttribute('viewBox', '0 0 14 14');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = paths;
  return icon;
}

function createEnergyFact(copy) {
  const item = document.createElement('div');
  item.className = 'fact-chip fact-chip-energy';
  const badges = document.createElement('span');
  badges.className = 'fact-energy-badges';
  ['dpe', 'ges'].forEach((key) => {
    const energy = copy.energy[key];
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = `fact-energy-badge fact-${key}-badge`;
    badge.setAttribute('aria-label', `${energy.chart} · ${copy.energy.openChart}`);
    const grade = document.createElement('span');
    grade.className = 'fact-energy-grade';
    const label = document.createElement('small');
    label.textContent = energy.label;
    const rating = document.createElement('strong');
    rating.textContent = energy.grade;
    const value = document.createElement('span');
    value.className = 'fact-energy-value';
    value.textContent = energy.value;
    grade.append(label, rating);
    badge.append(grade, value);
    badge.addEventListener('click', () => lightbox.openEnergyChart(key));
    badges.append(badge);
  });
  item.append(badges);
  return item;
}

function buildDocument() {
  const copy = i18n.dictionary().document;
  const facts = document.querySelector('#facts-grid');
  facts.replaceChildren(...copy.facts.map((value, index) => {
    const item = document.createElement('span');
    item.className = 'fact-chip';
    const icon = createFactIcon(index);
    const label = document.createElement('span');
    label.className = 'fact-label';
    label.textContent = value;
    if (icon) item.append(icon);
    item.append(label);
    return item;
  }), createEnergyFact(copy));

  const surfaceBody = document.querySelector('#surface-body');
  surfaceBody.replaceChildren(...copy.surfaces.map(([label, value]) => {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    const area = document.createElement('td');
    name.scope = 'row';
    name.textContent = label;
    area.textContent = value;
    row.append(name, area);
    return row;
  }));

}

const story = createStory({
  i18n,
  stage: elements.stage,
  copyLayer: elements.copyLayer,
  pinLayer: elements.pinLayer,
  rail: elements.rail,
  cueScrim: elements.cueScrim,
  cue: elements.cue,
  track: elements.track,
});

const lightbox = mountLightbox({
  i18n,
  story,
  gallery: document.querySelector('#gallery'),
});
buildDocument();
i18n.subscribe(buildDocument);
// Mounted before the viewer so the CTA survives a WebGL/WebGPU failure.
const cta = mountCta({ i18n, documentRoot: document.querySelector('#document') });

try {
  const viewer = await createViewer({
    canvas: elements.canvas,
    stage: elements.stage,
    loadState: elements.loadState,
    labelLayer: elements.labelLayer,
    i18n,
  });
  story.attachViewer(viewer);
  const featureContext = { ...elements, i18n, story, viewer };
  const featureCleanups = [
    mountStaging(featureContext),
    mountSun(featureContext),
    mountPlan(featureContext),
  ];
  const walkthrough = mountWalkthrough(featureContext);
  if (new URLSearchParams(location.search).has('pose')) {
    const { mountPoseCapture } = await import('./pose.js');
    featureCleanups.push(mountPoseCapture({ ...featureContext, walkthrough }));
  }
  const calibrationId = new URLSearchParams(location.search).get('calib');
  if (calibrationId) {
    const { mountCalibration } = await import('./calibration.js');
    featureCleanups.push(mountCalibration({ id: calibrationId, ...featureContext }));
  }
  document.documentElement.dataset.modelReady = '1';
  window.__listing = {
    backend: viewer.isWebGPU ? 'webgpu' : 'webgl2',
    get beat() { return story.beat; },
    story,
    viewer,
    walkthrough,
    lightbox,
    cta,
    features: featureCleanups,
  };
} catch {
  elements.stage.setAttribute('aria-busy', 'false');
  elements.stage.classList.add('viewer-unavailable');
  elements.loadState.hidden = true;
  elements.fallback.hidden = false;
  elements.fallback.dataset.i18n = 'ui.fallback';
  elements.fallback.textContent = i18n.t('ui.fallback');
}
