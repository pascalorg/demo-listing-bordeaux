import { MathUtils, Spherical, Vector3 } from 'three/webgpu';
import { assetUrl, FEATURE_MOUNTS, PHOTO_CAMS } from './config.js';
import { CHAMBRE1_RENDER_STYLES, decodeImage } from './renders.js';

const clamp = MathUtils.clamp;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hoverPointer = matchMedia('(hover: hover)');
const DWELL_VELOCITY_FLOOR = 0.04;
const DWELL_VELOCITY_POWER = 1.8;
const DWELL_LOOKUP_STEPS = 2048;
const WHEEL_FRICTION = 3.2;
const WHEEL_REFERENCE_DELTA = 100;
const WHEEL_IMPULSE_BEATS_PER_SECOND = 3.12;
const WHEEL_MAX_SPEED_BEATS = 5.75;
const WHEEL_STOP_SPEED = 1.5;
const LOOK_YAW_CLAMP = 0.90;
const LOOK_PITCH_CLAMP = 0.45;
const LOOK_SENSITIVITY = 0.0045;
const LOOK_RECENTER_SCROLL_EPSILON = 0.004;
const LOOK_RECENTER_DURATION_MS = 600;
const PARALLAX_YAW = MathUtils.degToRad(1.6);
const PARALLAX_PITCH = MathUtils.degToRad(1.0);
const FLIGHT_ARC_HEIGHT = 2.7;
const FLIGHT_ARC_WINDOW_START = 0.15;
const FLIGHT_ARC_WINDOW_END = 0.85;
const SHORT_FLIGHT_DISTANCE = 3.25;
const SHORT_FLIGHT_ARC_SCALE = 0.12;

function dwellVelocity(value) {
  return DWELL_VELOCITY_FLOOR
    + (1 - DWELL_VELOCITY_FLOOR) * Math.abs(Math.sin(Math.PI * value)) ** DWELL_VELOCITY_POWER;
}

const DWELL_LOOKUP = (() => {
  const values = new Float64Array(DWELL_LOOKUP_STEPS + 1);
  let cumulative = 0;
  let previous = dwellVelocity(0);
  for (let index = 1; index <= DWELL_LOOKUP_STEPS; index += 1) {
    const next = dwellVelocity(index / DWELL_LOOKUP_STEPS);
    cumulative += (previous + next) * 0.5;
    values[index] = cumulative;
    previous = next;
  }
  for (let index = 1; index <= DWELL_LOOKUP_STEPS; index += 1) values[index] /= cumulative;
  return values;
})();

export function mapDwellProgress(value) {
  const beat = Math.floor(value);
  const local = value - beat;
  if (local <= 0) return beat;
  const lookupPosition = local * DWELL_LOOKUP_STEPS;
  const lower = Math.floor(lookupPosition);
  const blend = lookupPosition - lower;
  const mapped = DWELL_LOOKUP[lower]
    + (DWELL_LOOKUP[Math.min(lower + 1, DWELL_LOOKUP_STEPS)] - DWELL_LOOKUP[lower]) * blend;
  return beat + mapped;
}

function windowedFlightArc(progress) {
  if (progress <= FLIGHT_ARC_WINDOW_START || progress >= FLIGHT_ARC_WINDOW_END) return 0;
  const local = (progress - FLIGHT_ARC_WINDOW_START) / (FLIGHT_ARC_WINDOW_END - FLIGHT_ARC_WINDOW_START);
  return Math.sin(Math.PI * local) ** 2;
}

function gentleEase(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function hermiteValue(a, b, tangentA, tangentB, progress, span) {
  const t2 = progress * progress;
  const t3 = t2 * progress;
  return (2 * t3 - 3 * t2 + 1) * a
    + (t3 - 2 * t2 + progress) * tangentA * span
    + (-2 * t3 + 3 * t2) * b
    + (t3 - t2) * tangentB * span;
}

function shapePreservingTangent(values, times, index) {
  if (index === 0) return (values[1] - values[0]) / (times[1] - times[0]);
  if (index === values.length - 1) {
    return (values[index] - values[index - 1]) / (times[index] - times[index - 1]);
  }
  const previousSpan = times[index] - times[index - 1];
  const nextSpan = times[index + 1] - times[index];
  const previousSlope = (values[index] - values[index - 1]) / previousSpan;
  const nextSlope = (values[index + 1] - values[index]) / nextSpan;
  if (previousSlope * nextSlope <= 0) return 0;
  const previousWeight = 2 * nextSpan + previousSpan;
  const nextWeight = nextSpan + 2 * previousSpan;
  return (previousWeight + nextWeight)
    / (previousWeight / previousSlope + nextWeight / nextSlope);
}

function interpolateVia(from, to, definitions, progress, outPosition, outTarget) {
  const poses = [
    { at: 0, eye: from.p.toArray(), tgt: from.t.toArray(), fov: from.fov },
    ...definitions.map((pose, index) => ({
      ...pose,
      at: clamp(pose.at ?? ((index + 1) / (definitions.length + 1)), 0.001, 0.999),
    })).sort((a, b) => a.at - b.at),
    { at: 1, eye: to.p.toArray(), tgt: to.t.toArray(), fov: to.fov },
  ];
  let segment = 0;
  while (segment < poses.length - 2 && progress > poses[segment + 1].at) segment += 1;
  const current = poses[segment];
  const next = poses[segment + 1];
  const span = Math.max(0.0001, next.at - current.at);
  const local = clamp((progress - current.at) / span, 0, 1);
  const component = (key, axis) => {
    const values = poses.map((pose) => pose[key][axis]);
    const times = poses.map((pose) => pose.at);
    const tangentA = shapePreservingTangent(values, times, segment);
    const tangentB = shapePreservingTangent(values, times, segment + 1);
    return hermiteValue(current[key][axis], next[key][axis], tangentA, tangentB, local, span);
  };
  outPosition.set(component('eye', 0), component('eye', 1), component('eye', 2));
  outTarget.set(component('tgt', 0), component('tgt', 1), component('tgt', 2));
  const fovs = poses.map((pose) => pose.fov ?? (from.fov + (to.fov - from.fov) * pose.at));
  const times = poses.map((pose) => pose.at);
  const fovTangentA = shapePreservingTangent(fovs, times, segment);
  const fovTangentB = shapePreservingTangent(fovs, times, segment + 1);
  return hermiteValue(fovs[segment], fovs[segment + 1], fovTangentA, fovTangentB, local, span);
}

const BEATS = Object.freeze([
  { id: 'hero', orb: [-0.78, 0.62, 1], fov: 34, off: [-0.15, 0], place: 'left-mid', wide: true },
  { id: 'floor', orb: [-0.78, 0.88, 0.94], fov: 35, off: [0, 0.1], place: 'left-bottom', cardLift: 130, zones: 'labels' },
  {
    // Optional `via` shapes the transition into this beat. Format: one or more
    // { eye: [x,y,z], tgt: [x,y,z], fov?: number, at?: 0..1 }; `at` defaults evenly.
    id: 'sejour', eye: [-3.05, 1.62, -3.72], tgt: [-7.55, 1.08, -2.48], fov: 62,
    via: [
      { eye: [5.58, 2.86, -4.35], tgt: [0.8, 2.25, -3], fov: 59.01, at: 0.36 },
      { eye: [-1.55, 1.64, -3.1], tgt: [-6.2, 1.18, -2.72], fov: 66, at: 0.7 },
    ],
    doors: ['door_cvdmtaj49xgwpnfh'],
    scrubStart: 0.52,
    off: [0.14, 0], place: 'right-mid', pins: [
      { p: [-2.2, 1.35, -3.1], key: 'balconyDoor' },
      { p: [-8.1, 1.35, -4.25], key: 'openKitchen' },
    ],
  },
  {
    id: 'staging', eye: PHOTO_CAMS.sejour.eye, tgt: PHOTO_CAMS.sejour.tgt, fov: PHOTO_CAMS.sejour.fov,
    off: [0, 0], place: 'left-top', arcScale: 0.08, features: { staging: FEATURE_MOUNTS.staging },
  },
  {
    id: 'balcon', eye: [-1.28, 1.58, -3.72], tgt: [-1.32, 1.05, 0.1], fov: 66,
    off: [0, 0.08], place: 'left-bottom', cardLift: 130, features: { sun: FEATURE_MOUNTS.sun },
  },
  {
    id: 'chambre1', eye: PHOTO_CAMS.chambre1.eye, tgt: PHOTO_CAMS.chambre1.tgt, fov: PHOTO_CAMS.chambre1.fov,
    via: [
      { eye: [1.65, 1.37, 5.85], tgt: [-3.34, 1.09, 5.76], fov: 67.88, at: 0.46 },
      { eye: [-1.98, 0.92, 5.67], tgt: [-6.97, 0.73, 5.75], fov: 69.47, at: 0.7 },
      { eye: [-3.61, 0.88, 5.55], tgt: [-8.58, 0.82, 6.02], fov: 69.87, at: 0.8 },
    ],
    windows: ['window_cheeuc6e0qbb0e44'],
    scrubStart: 0.47,
    arcScale: 0,
    off: [0.2, 0], place: 'left-mid', photo: assetUrl('assets/photos/chambre-1a.jpg'),
  },
  {
    id: 'salledeau', eye: PHOTO_CAMS.salledeau.eye, tgt: PHOTO_CAMS.salledeau.tgt, fov: PHOTO_CAMS.salledeau.fov,
    via: [{ eye: [-3.4, 1.07, 7.22], tgt: [-8.38, 1.08, 6.76], fov: 72.79, at: 0.35 }],
    doors: ['door_2udbl7hf9ws2cdnr'],
    scrubStart: 0.58,
    arcScale: 0,
    off: [0.14, 0], place: 'left-mid', photo: assetUrl('assets/photos/salle-deau.jpg'),
  },
  {
    id: 'chambres', eye: [0.25, 5.8, 2.4], tgt: [-4.3, 0.9, 1.8], fov: 42,
    via: [{ eye: [-5.36, 4.01, 6.75], tgt: [-7.84, 0.82, 3.81], fov: 72.37, at: 0.16 }],
    arcScale: 0,
    off: [0.13, 0.02], place: 'right-mid', pins: [
      { p: [-4.3069, 1.2, 3.2594], key: 'room2' },
      { p: [-4.2875, 1.2, 0.3028], key: 'room3' },
    ],
  },
  {
    // Captured plan-entry pose. Its target is a five-metre look-direction marker;
    // the plan orbit resolves a collinear floor-height pivot on first interaction.
    id: 'plan', eye: [-8.69, 30.18, 1.99], tgt: [-8.69, 25.18, 1.94], fov: 30.01, arcScale: 0, off: [-0.037, 0.03],
    place: 'right-bottom', zones: 'active', features: { plan: FEATURE_MOUNTS.plan },
  },
]);

function cardMarkup(copy) {
  const figures = copy.figs?.map((figure) => `<span class="figure-chip">${figure}</span>`).join('') ?? '';
  return `<span class="beat-kicker">${copy.k}</span><h2>${copy.h}</h2><p>${copy.p}</p>${
    copy.price ? `<p class="beat-price">${copy.price}</p>` : ''
  }${figures ? `<div class="beat-figures">${figures}</div>` : ''}`;
}

export function createStory({ i18n, stage, copyLayer, pinLayer, rail, cueScrim, cue, track }) {
  let viewer = null;
  let cards = [];
  let photoCards = [];
  let pins = [];
  let beatTarget = 0;
  let beatSmoothA = 0;
  let beatSmoothB = 0;
  let userAzimuth = 0;
  let userPitch = 0;
  let lookRecenter = null;
  let lookScrollAnchor = 0;
  let pointerYawTarget = 0;
  let pointerPitchTarget = 0;
  let pointerYaw = 0;
  let pointerPitch = 0;
  let activeZoneMode = '';
  let lastZoneLabelFade = 0;
  let docMode = false;
  let suspended = false;
  let browse = null;
  let cameraOverride = null;
  let chambre1Selection = 'photo';
  let copyGeneration = 0;
  let lastTime = performance.now();
  let viewportHeight = innerHeight;
  let frameRaf = 0;
  let hashRaf = 0;
  let destroyed = false;
  let scrollMode = 'idle';
  let scrollVelocity = 0;
  let scrollPosition = scrollY;
  let scrollRaf = 0;
  let scrollLastTime = 0;
  let commandedScroll = scrollY;
  let commandedAt = 0;
  let externalScroll = scrollY;
  let externalScrollTime = performance.now();
  let externalVelocityTimer = 0;
  const frameListeners = new Set();
  const lookLocks = new Set();
  const renderLocks = new Set();
  const position = new Vector3();
  const target = new Vector3();
  const scratch = new Vector3();
  const lookSpherical = new Spherical();
  const lastCameraTarget = new Vector3();
  const keyA = { p: new Vector3(), t: new Vector3(), fov: 34, ox: 0, oy: 0 };
  const keyB = { p: new Vector3(), t: new Vector3(), fov: 34, ox: 0, oy: 0 };

  function sizeTrack(preserve = true) {
    const oldHeight = viewportHeight || innerHeight;
    const oldTrackHeight = track.offsetHeight;
    const oldTrackBottom = track.offsetTop + oldTrackHeight;
    const inDocument = preserve && oldTrackHeight > 0 && scrollY >= oldTrackBottom;
    const documentOffset = scrollY - oldTrackBottom;
    const storyPosition = preserve
      ? clamp((scrollY - track.offsetTop) / oldHeight, 0, BEATS.length)
      : 0;
    viewportHeight = innerHeight;
    track.style.height = `${innerHeight * BEATS.length}px`;
    if (preserve && oldTrackHeight > 0) {
      const top = inDocument
        ? track.offsetTop + track.offsetHeight + documentOffset
        : track.offsetTop + storyPosition * viewportHeight;
      window.scrollTo({ top, behavior: 'instant' });
    }
    viewer?.invalidate();
  }

  function readScroll() {
    const span = track.offsetHeight - innerHeight;
    if (span <= 0) return 0;
    return clamp((scrollY - track.offsetTop) / span, 0, 1) * (BEATS.length - 1);
  }

  function goToBeat(index, updateHash = true) {
    cancelScrollMotion();
    browse = null;
    document.body.classList.remove('browse-mode');
    lookScrollAnchor = readScroll();
    if (updateHash) history.replaceState(null, '', `#${BEATS[index].id}`);
    window.scrollTo({
      top: track.offsetTop + index * innerHeight,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }

  function rebuildCopy() {
    const generation = ++copyGeneration;
    copyLayer.replaceChildren();
    photoCards = [];
    cards = BEATS.map((beat, index) => {
      const card = document.createElement('article');
      card.className = `beat-card${beat.wide ? ' beat-card-wide' : ''}`;
      card.dataset.place = beat.place;
      card.dataset.beat = beat.id;
      card.style.setProperty('--card-lift', `${beat.cardLift ?? 0}px`);
      card.id = beat.id;
      card.innerHTML = cardMarkup(i18n.dictionary().beats[beat.id]);
      copyLayer.append(card);
      if (beat.photo) {
        const figure = document.createElement('figure');
        figure.className = 'beat-photo-card';
        figure.dataset.photoBeat = beat.id;
        const imageFrame = document.createElement('div');
        imageFrame.className = 'beat-photo-frame';
        const images = [0, 1].map(() => {
          const image = document.createElement('img');
          image.alt = '';
          image.decoding = 'async';
          imageFrame.append(image);
          return image;
        });
        const styleSources = beat.id === 'chambre1' ? {
          photo: beat.photo,
          ...Object.fromEntries(CHAMBRE1_RENDER_STYLES.map(({ id, source }) => [id, source])),
        } : { photo: beat.photo };
        let selection = beat.id === 'chambre1' && styleSources[chambre1Selection]
          ? chambre1Selection
          : 'photo';
        const imageAlt = (id) => id === 'photo'
          ? i18n.dictionary().beats[beat.id].photoCaption
          : `${i18n.t('ui.renderProjection')} — ${i18n.t(`ui.renderStyles.${id}`)}`;
        images[0].src = styleSources[selection];
        images[0].alt = imageAlt(selection);
        images[0].classList.add('is-current');
        const caption = document.createElement('figcaption');
        caption.textContent = imageAlt(selection);
        figure.append(imageFrame);
        if (beat.id === 'chambre1') {
          const tabs = document.createElement('div');
          tabs.className = 'beat-photo-tabs';
          tabs.setAttribute('role', 'group');
          let visibleImage = 0;
          let pendingSelection = 0;
          const styleIds = ['photo', ...CHAMBRE1_RENDER_STYLES.map(({ id }) => id)];
          styleIds.forEach((id) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.style = id;
            button.textContent = id === 'photo' ? i18n.t('ui.photo') : i18n.t(`ui.renderStyles.${id}`);
            button.setAttribute('aria-pressed', String(id === selection));
            button.addEventListener('click', async () => {
              if (id === selection) return;
              const token = ++pendingSelection;
              const next = 1 - visibleImage;
              try {
                await decodeImage(images[next], styleSources[id]);
              } catch {
                return;
              }
              // A language change rebuilds the whole card. Never let a decode
              // that belonged to the detached card commit into stale buffers.
              if (token !== pendingSelection || generation !== copyGeneration || !figure.isConnected) return;
              selection = id;
              chambre1Selection = id;
              images[next].alt = imageAlt(id);
              images[next].classList.add('is-current');
              images[visibleImage].classList.remove('is-current');
              visibleImage = next;
              caption.textContent = images[next].alt;
              tabs.querySelectorAll('button').forEach((candidate) => {
                candidate.setAttribute('aria-pressed', String(candidate.dataset.style === id));
              });
            });
            tabs.append(button);
          });
          figure.append(tabs);
        }
        figure.append(caption);
        copyLayer.append(figure);
        photoCards.push({ element: figure, beat: index });
      }
      return card;
    });
  }

  function rebuildRail() {
    rail.replaceChildren();
    rail.setAttribute('aria-label', i18n.t('ui.chapters'));
    const capsule = document.createElement('div');
    capsule.className = 'chapter-rail-capsule';
    BEATS.forEach((beat, index) => {
      const button = document.createElement('button');
      const nav = i18n.dictionary().beats[beat.id].nav;
      button.type = 'button';
      button.setAttribute('aria-label', `${i18n.t('ui.goTo')} ${nav}`);
      button.innerHTML = `<em>${nav}</em><s></s>`;
      button.addEventListener('click', () => goToBeat(index));
      capsule.append(button);
    });
    rail.append(capsule);
  }

  function rebuildPins() {
    pinLayer.replaceChildren();
    pins = [];
    BEATS.forEach((beat, beatIndex) => {
      beat.pins?.forEach((definition) => {
        const [label, suffix] = i18n.dictionary().pins[definition.key];
        const element = document.createElement('div');
        element.className = 'pin';
        element.innerHTML = `<i></i><span>${label}${suffix ? `<em>${suffix}</em>` : ''}</span>`;
        pinLayer.append(element);
        pins.push({ element, beat: beatIndex, point: new Vector3(...definition.p) });
      });
    });
  }

  function rebuildLanguage() {
    rebuildCopy();
    rebuildRail();
    rebuildPins();
  }

  function fittedDistance(beat, azimuth, elevation) {
    const { size } = viewer;
    const verticalFov = MathUtils.degToRad(beat.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * viewer.camera.aspect);
    const sa = Math.abs(Math.sin(azimuth));
    const ca = Math.abs(Math.cos(azimuth));
    const projectedWidth = size.x * sa + size.z * ca;
    const projectedHeight = (size.x * ca + size.z * sa) * Math.sin(elevation) + size.y * Math.cos(elevation);
    return Math.max(
      (projectedWidth / 2) / Math.tan(horizontalFov / 2),
      (projectedHeight / 2) / Math.tan(verticalFov / 2),
    ) * 1.16;
  }

  function resolve(beat, out, time) {
    if (beat.eye) {
      out.p.fromArray(beat.eye);
      out.t.fromArray(beat.tgt);
      if (userAzimuth || userPitch) {
        scratch.subVectors(out.t, out.p);
        const spherical = new Spherical().setFromVector3(scratch);
        spherical.theta += userAzimuth * 0.55;
        spherical.phi = clamp(spherical.phi + userPitch * 0.55, 0.05, Math.PI - 0.05);
        out.t.copy(scratch.setFromSpherical(spherical).add(out.p));
      }
    } else {
      const azimuth = beat.orb[0] + userAzimuth;
      const elevation = clamp(beat.orb[1] + userPitch, 0.08, Math.PI / 2 - 0.05);
      const fittingOffset = stage.clientWidth <= 900 && beat.id === 'plan' ? [0, 0] : beat.off;
      const offsetPad = Math.max(
        0.5 / (0.5 - Math.min(0.4, Math.abs(fittingOffset[0]))),
        0.5 / (0.5 - Math.min(0.4, Math.abs(fittingOffset[1]))),
      );
      const distance = fittedDistance(beat, azimuth, elevation) * beat.orb[2] * offsetPad;
      out.p.set(
        viewer.center.x + distance * Math.cos(elevation) * Math.cos(azimuth),
        viewer.center.y + distance * Math.sin(elevation),
        viewer.center.z + distance * Math.cos(elevation) * Math.sin(azimuth),
      );
      out.t.copy(viewer.center);
    }
    out.fov = beat.fov;
    [out.ox, out.oy] = beat.off;
  }

  function paintCopy(value) {
    cards.forEach((card, index) => {
      const opacity = clamp(1 - Math.abs(value - index) / 0.52, 0, 1);
      const shift = clamp((value - index) * 26, -34, 34);
      const centered = ['left-mid', 'right-mid'].includes(card.dataset.place) ? 'translateY(-50%) ' : '';
      card.style.opacity = opacity.toFixed(3);
      card.style.pointerEvents = opacity > 0.92 ? 'auto' : 'none';
      card.style.transform = `${centered}translate3d(0, ${-shift}px, 0)`;
    });
    photoCards.forEach(({ element, beat }) => {
      const opacity = clamp(1 - Math.abs(value - beat) / 0.52, 0, 1);
      const shift = clamp((value - beat) * 22, -30, 30);
      element.style.opacity = opacity.toFixed(3);
      element.style.pointerEvents = opacity > 0.35 ? 'auto' : 'none';
      element.style.transform = stage.clientWidth <= 900
        ? `translateY(${-shift}px)`
        : `translateY(calc(-50% + ${-shift}px))`;
    });
    const current = Math.round(value);
    rail.querySelectorAll('button').forEach((button, index) => {
      button.setAttribute('aria-current', String(index === current));
    });
    cue.style.opacity = value < 0.12 ? '1' : '0';
    cueScrim.style.opacity = value < 0.12 ? '1' : '0';
  }

  function paintPins(value) {
    if (!viewer) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    for (const pin of pins) {
      const opacity = clamp(1 - Math.abs(value - pin.beat) / 0.42, 0, 1);
      if (opacity <= 0.01) {
        pin.element.hidden = true;
        continue;
      }
      scratch.copy(pin.point).project(viewer.camera);
      const visible = scratch.z < 1 && Math.abs(scratch.x) < 1.05 && Math.abs(scratch.y) < 1.05;
      pin.element.hidden = !visible;
      if (!visible) continue;
      pin.element.style.opacity = opacity.toFixed(3);
      pin.element.style.left = `${(scratch.x * 0.5 + 0.5) * width}px`;
      pin.element.style.top = `${(-scratch.y * 0.5 + 0.5) * height}px`;
      pin.element.classList.toggle('flip', scratch.x > 0.45);
    }
  }

  function floorLabelFade(value) {
    if (value <= 1) {
      const progress = clamp((value - 0.5) / 0.28, 0, 1);
      return progress * progress * (3 - 2 * progress);
    }
    const progress = clamp((value - 1.22) / 0.28, 0, 1);
    return 1 - progress * progress * (3 - 2 * progress);
  }

  function frame(time) {
    if (destroyed) return;
    frameRaf = requestAnimationFrame(frame);
    const elapsedSeconds = (time - lastTime) / 1000;
    const delta = Math.min(0.1, elapsedSeconds);
    const smoothDelta = Math.min(0.5, elapsedSeconds);
    lastTime = time;
    beatTarget = readScroll();
    if (!dragging && !lookRecenter
      && (Math.abs(userAzimuth) > 0.000001 || Math.abs(userPitch) > 0.000001)
      && Math.abs(beatTarget - lookScrollAnchor) > LOOK_RECENTER_SCROLL_EPSILON) {
      lookRecenter = {
        started: time,
        yaw: userAzimuth,
        pitch: userPitch,
      };
    }
    let lookRecentering = false;
    if (lookRecenter) {
      const progress = clamp((time - lookRecenter.started) / LOOK_RECENTER_DURATION_MS, 0, 1);
      const easedProgress = progress * progress * (3 - 2 * progress);
      userAzimuth = lookRecenter.yaw * (1 - easedProgress);
      userPitch = lookRecenter.pitch * (1 - easedProgress);
      lookRecentering = progress < 1;
      if (!lookRecentering) {
        userAzimuth = 0;
        userPitch = 0;
        lookRecenter = null;
        lookScrollAnchor = beatTarget;
      }
    }
    if (reducedMotion) {
      beatSmoothA = beatTarget;
      beatSmoothB = beatTarget;
    } else {
      beatSmoothA += (beatTarget - beatSmoothA) * (1 - Math.exp(-smoothDelta * 14.9));
      beatSmoothB += (beatSmoothA - beatSmoothB) * (1 - Math.exp(-smoothDelta * 23.1));
    }
    const pacedValue = reducedMotion ? beatSmoothB : mapDwellProgress(beatSmoothB);
    paintCopy(pacedValue);

    const nextDocMode = scrollY >= track.offsetTop + track.offsetHeight;
    if (nextDocMode !== docMode) {
      docMode = nextDocMode;
      document.body.classList.toggle('document-mode', docMode);
    }
    const nearest = Math.round(pacedValue);
    const frameState = {
      value: pacedValue,
      targetValue: reducedMotion ? beatTarget : mapDwellProgress(beatTarget),
      beat: BEATS[nearest]?.id ?? BEATS[0].id,
      settled: Math.abs(beatTarget - beatSmoothB) < 0.025,
      docMode,
      suspended,
      browsing: Boolean(browse),
    };
    frameListeners.forEach((listener) => listener(frameState));
    if (viewer) {
      const nextZoneLabelFade = browse || docMode || suspended ? 0 : floorLabelFade(pacedValue);
      const animateZoneLabelJump = !docMode && !suspended
        && Math.abs(nextZoneLabelFade - lastZoneLabelFade) > 0.35;
      viewer.zones.setLabelFade(nextZoneLabelFade, animateZoneLabelJump);
      lastZoneLabelFade = nextZoneLabelFade;
    }
    if (!viewer || docMode || suspended) return;

    const parallaxActive = hoverPointer.matches
      && !reducedMotion
      && !browse
      && !lookLocks.size
      && !document.body.classList.contains('calibration-active');
    const desiredYaw = parallaxActive ? pointerYawTarget : 0;
    const desiredPitch = parallaxActive ? pointerPitchTarget : 0;
    const parallaxResponse = 1 - Math.pow(0.95, Math.max(1, delta * 60));
    const previousYaw = pointerYaw;
    const previousPitch = pointerPitch;
    pointerYaw += (desiredYaw - pointerYaw) * parallaxResponse;
    pointerPitch += (desiredPitch - pointerPitch) * parallaxResponse;
    if (Math.abs(pointerYaw) < 0.000001 && !desiredYaw) pointerYaw = 0;
    if (Math.abs(pointerPitch) < 0.000001 && !desiredPitch) pointerPitch = 0;
    const parallaxMoving = Math.abs(pointerYaw - previousYaw) > 0.000001
      || Math.abs(pointerPitch - previousPitch) > 0.000001;

    const lower = clamp(Math.floor(pacedValue), 0, BEATS.length - 2);
    const blend = clamp(pacedValue - lower, 0, 1);
    const eased = blend;
    resolve(BEATS[lower], keyA, time);
    resolve(BEATS[lower + 1], keyB, time);
    let renderedFov;
    if (BEATS[lower + 1].via?.length) {
      renderedFov = interpolateVia(keyA, keyB, BEATS[lower + 1].via, eased, position, target);
    } else {
      position.lerpVectors(keyA.p, keyB.p, eased);
      target.lerpVectors(keyA.t, keyB.t, eased);
      renderedFov = keyA.fov + (keyB.fov - keyA.fov) * eased;
    }
    if (BEATS[lower].eye && BEATS[lower + 1].eye) {
      const distance = Math.hypot(
        BEATS[lower].eye[0] - BEATS[lower + 1].eye[0],
        BEATS[lower].eye[1] - BEATS[lower + 1].eye[1],
        BEATS[lower].eye[2] - BEATS[lower + 1].eye[2],
      );
      const distanceScale = distance < SHORT_FLIGHT_DISTANCE ? SHORT_FLIGHT_ARC_SCALE : 1;
      const beatScale = BEATS[lower + 1].arcScale ?? 1;
      position.y += windowedFlightArc(eased) * FLIGHT_ARC_HEIGHT * distanceScale * beatScale;
    }
    if (pointerYaw || pointerPitch) {
      scratch.subVectors(target, position);
      const distance = scratch.length();
      lookSpherical.setFromVector3(scratch);
      lookSpherical.theta += pointerYaw;
      lookSpherical.phi = clamp(lookSpherical.phi + pointerPitch, 0.05, Math.PI - 0.05);
      target.copy(scratch.setFromSpherical(lookSpherical).setLength(distance).add(position));
    }

    const camera = viewer.camera;
    let ox = keyA.ox + (keyB.ox - keyA.ox) * eased;
    let oy = keyA.oy + (keyB.oy - keyA.oy) * eased;
    if (stage.clientWidth <= 900) {
      ox = 0;
      const card = cards[nearest];
      const stageTop = stage.getBoundingClientRect().top;
      const cardTop = card?.getBoundingClientRect().top ?? innerHeight;
      document.documentElement.style.setProperty('--mobile-sheet-bottom', `${Math.max(0, innerHeight - cardTop)}px`);
      if (BEATS[nearest]?.id === 'plan') {
        const visibleHeight = clamp(cardTop - stageTop - 8, stage.clientHeight * 0.35, stage.clientHeight);
        oy = (stage.clientHeight - visibleHeight) / (2 * stage.clientHeight);
      } else {
        oy = 0.13;
      }
    } else {
      document.documentElement.style.removeProperty('--mobile-sheet-bottom');
    }
    camera.fov = renderedFov;
    camera.position.copy(position);
    camera.lookAt(target);
    if (Math.abs(ox) < 0.002 && Math.abs(oy) < 0.002) camera.clearViewOffset();
    else camera.setViewOffset(stage.clientWidth, stage.clientHeight, ox * stage.clientWidth, oy * stage.clientHeight, stage.clientWidth, stage.clientHeight);
    if (browse) {
      const elapsed = reducedMotion ? 1 : clamp((time - browse.started) / 900, 0, 1);
      browse.flying = elapsed < 1;
      const flyEase = elapsed * elapsed * (3 - 2 * elapsed);
      camera.position.lerpVectors(browse.fromEye, browse.toEye, flyEase);
      target.lerpVectors(browse.fromTarget, browse.toTarget, flyEase);
      camera.fov = browse.fromFov + (browse.toFov - browse.fromFov) * flyEase;
      camera.clearViewOffset();
      camera.lookAt(target);
    }
    cameraOverride?.({ camera, target, time, delta });
    camera.updateProjectionMatrix();
    lastCameraTarget.copy(target);

    BEATS.forEach((beat, index) => {
      if (index === 0) return;
      const rawProgress = clamp(pacedValue - (index - 1), 0, 1);
      const scrubStart = clamp(beat.scrubStart ?? 0, 0, 0.999);
      const transitionProgress = gentleEase(clamp((rawProgress - scrubStart) / (1 - scrubStart), 0, 1));
      beat.doors?.forEach((doorId) => viewer.doors.scrub(doorId, transitionProgress));
      beat.windows?.forEach((windowId) => viewer.windows.scrub(windowId, transitionProgress));
    });

    const zoneMode = browse ? 'off' : (BEATS[nearest].zones ?? 'off');
    if (zoneMode !== activeZoneMode) {
      activeZoneMode = zoneMode;
      viewer.zones.setMode(zoneMode);
    }
    const cameraMoving = Math.abs(beatTarget - beatSmoothB) > 0.0004
      || Boolean(browse?.flying)
      || lookRecentering
      || parallaxMoving;
    if (!renderLocks.size) {
      if (cameraMoving) viewer.invalidate();
      viewer.render(false, delta);
    }
    paintPins(pacedValue);
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const pointerDown = (event) => {
    if (event.pointerType !== 'mouse' || suspended || lookLocks.size) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    lookRecenter = null;
    lookScrollAnchor = readScroll();
    stage.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event) => {
    if (event.pointerType === 'mouse' && hoverPointer.matches) {
      const bounds = stage.getBoundingClientRect();
      pointerYawTarget = clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1) * PARALLAX_YAW;
      pointerPitchTarget = clamp(((event.clientY - bounds.top) / bounds.height) * 2 - 1, -1, 1) * PARALLAX_PITCH;
      viewer?.invalidate();
    }
    if (!dragging || suspended || lookLocks.size) return;
    userAzimuth = clamp(userAzimuth - (event.clientX - lastX) * LOOK_SENSITIVITY, -LOOK_YAW_CLAMP, LOOK_YAW_CLAMP);
    userPitch = clamp(userPitch + (event.clientY - lastY) * LOOK_SENSITIVITY, -LOOK_PITCH_CLAMP, LOOK_PITCH_CLAMP);
    lastX = event.clientX;
    lastY = event.clientY;
    lookScrollAnchor = readScroll();
    viewer?.invalidate();
  };
  const pointerEnd = (event) => {
    dragging = false;
    if (event?.type === 'pointerleave') {
      pointerYawTarget = 0;
      pointerPitchTarget = 0;
    }
  };
  stage.addEventListener('pointerdown', pointerDown);
  stage.addEventListener('pointermove', pointerMove);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => stage.addEventListener(type, pointerEnd));

  const handleResize = () => {
    cancelScrollMotion();
    sizeTrack(true);
  };
  window.addEventListener('resize', handleResize, { passive: true });
  const resumeBrowse = () => {
    if (!browse) return;
    browse = null;
    document.body.classList.remove('browse-mode');
    viewer?.invalidate();
  };
  const navigationKeys = new Set(['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar']);
  const handleNavigationKey = (event) => {
    if (navigationKeys.has(event.key)) {
      cancelScrollMotion();
      resumeBrowse();
    }
  };

  function cancelScrollMotion() {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
    scrollMode = 'idle';
    scrollVelocity = 0;
    scrollPosition = scrollY;
    scrollLastTime = 0;
  }

  const handleScroll = () => {
    const now = performance.now();
    const authorityWrite = now - commandedAt < 80 && Math.abs(scrollY - commandedScroll) <= 1;
    if (!authorityWrite) {
      const elapsed = Math.max(1, now - externalScrollTime);
      if (scrollMode !== 'idle') cancelScrollMotion();
      scrollVelocity = ((scrollY - externalScroll) / elapsed) * 1000;
      externalScroll = scrollY;
      externalScrollTime = now;
      window.clearTimeout(externalVelocityTimer);
      externalVelocityTimer = window.setTimeout(() => {
        if (scrollMode === 'idle') scrollVelocity = 0;
      }, 80);
    }
    if (browse) resumeBrowse();
    viewer?.invalidate();
  };
  window.addEventListener('keydown', handleNavigationKey);
  window.addEventListener('scroll', handleScroll, { passive: true });

  function writeAuthorityScroll(top) {
    commandedScroll = top;
    commandedAt = performance.now();
    window.scrollTo({ top, behavior: 'instant' });
  }

  function stepScrollMotion(time) {
    if (scrollMode !== 'inertia') {
      scrollRaf = 0;
      return;
    }

    const delta = scrollLastTime ? Math.min(0.05, (time - scrollLastTime) / 1000) : 1 / 60;
    scrollLastTime = time;
    const decay = Math.exp(-WHEEL_FRICTION * delta);
    const travel = scrollVelocity * (1 - decay) / WHEEL_FRICTION;
    const storyStart = track.offsetTop;
    const storyEnd = storyStart + track.offsetHeight;
    const nextPosition = clamp(scrollPosition + travel, storyStart, storyEnd);
    const hitBoundary = nextPosition !== scrollPosition + travel;
    scrollPosition = nextPosition;
    scrollVelocity *= decay;
    writeAuthorityScroll(scrollPosition);

    if (hitBoundary || Math.abs(scrollVelocity) <= WHEEL_STOP_SPEED) {
      scrollVelocity = 0;
      scrollMode = 'idle';
      scrollRaf = 0;
      scrollLastTime = 0;
      externalScroll = scrollY;
      externalScrollTime = performance.now();
      return;
    }
    scrollRaf = requestAnimationFrame(stepScrollMotion);
  }

  function smoothWheel(event) {
    const discrete = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(event.deltaY) >= 40;
    resumeBrowse();
    if (reducedMotion || event.defaultPrevented || event.ctrlKey || event.deltaY === 0) return;
    if (!discrete) {
      cancelScrollMotion();
      return;
    }
    const storyStart = track.offsetTop;
    const storyEnd = track.offsetTop + track.offsetHeight;
    if ((event.deltaY < 0 && scrollY <= storyStart + 1) || (event.deltaY > 0 && scrollY >= storyEnd - 1)) {
      cancelScrollMotion();
      return;
    }
    if (scrollY < storyStart - 1 || scrollY > storyEnd + 1) return;
    event.preventDefault();
    const modeScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 38
      : (event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1);
    const normalizedDelta = event.deltaY * modeScale;
    if (scrollMode !== 'inertia') {
      scrollPosition = scrollY;
      scrollVelocity = 0;
      scrollLastTime = performance.now();
    }
    const impulse = (normalizedDelta / WHEEL_REFERENCE_DELTA)
      * WHEEL_IMPULSE_BEATS_PER_SECOND * innerHeight;
    scrollVelocity = clamp(
      scrollVelocity + impulse,
      -WHEEL_MAX_SPEED_BEATS * innerHeight,
      WHEEL_MAX_SPEED_BEATS * innerHeight,
    );
    scrollMode = 'inertia';
    externalScroll = scrollY;
    externalScrollTime = performance.now();
    if (!scrollRaf) scrollRaf = requestAnimationFrame(stepScrollMotion);
  }

  window.addEventListener('wheel', smoothWheel, { passive: false });
  const handleTouchInput = () => {
    cancelScrollMotion();
    resumeBrowse();
  };
  window.addEventListener('touchstart', handleTouchInput, { passive: true });
  window.addEventListener('touchmove', handleTouchInput, { passive: true });
  rebuildLanguage();
  sizeTrack(false);
  const unsubscribe = i18n.subscribe(rebuildLanguage);
  frameRaf = requestAnimationFrame(frame);

  hashRaf = requestAnimationFrame(() => {
    const id = location.hash.slice(1);
    const index = BEATS.findIndex((beat) => beat.id === id);
    if (index >= 0) goToBeat(index, false);
  });

  return {
    beats: BEATS,
    get beat() {
      const value = reducedMotion ? beatSmoothB : mapDwellProgress(beatSmoothB);
      return BEATS[Math.round(value)]?.id ?? BEATS[0].id;
    },
    get value() { return reducedMotion ? beatSmoothB : mapDwellProgress(beatSmoothB); },
    get targetValue() { return reducedMotion ? beatTarget : mapDwellProgress(beatTarget); },
    get transition() {
      const value = reducedMotion ? beatSmoothB : mapDwellProgress(beatSmoothB);
      const from = clamp(Math.floor(value), 0, BEATS.length - 2);
      return {
        from: BEATS[from].id,
        to: BEATS[from + 1].id,
        progress: clamp(value - from, 0, 1),
      };
    },
    get moment() {
      const value = reducedMotion ? beatSmoothB : mapDwellProgress(beatSmoothB);
      const nearest = Math.round(value);
      if (Math.abs(value - nearest) < 0.005) {
        return { beat: BEATS[nearest]?.id ?? BEATS[0].id };
      }
      const from = clamp(Math.floor(value), 0, BEATS.length - 2);
      return {
        transition: `${BEATS[from].id} → ${BEATS[from + 1].id}`,
        t: clamp(value - from, 0, 1),
      };
    },
    get browsing() { return Boolean(browse); },
    get browseFlying() { return Boolean(browse?.flying); },
    get scrollAuthority() {
      return {
        mode: scrollMode,
        position: scrollPosition,
        velocity: scrollVelocity,
        captureMode: 'discrete-inertia',
        friction: WHEEL_FRICTION,
        impulseBeatsPerSecond: WHEEL_IMPULSE_BEATS_PER_SECOND,
        stopSpeed: WHEEL_STOP_SPEED,
      };
    },
    get motionProfile() {
      return {
        dwellVelocityFloor: DWELL_VELOCITY_FLOOR,
        dwellVelocityPower: DWELL_VELOCITY_POWER,
        dwellLookupSteps: DWELL_LOOKUP_STEPS,
        flightArcHeight: FLIGHT_ARC_HEIGHT,
        flightArcWindow: [FLIGHT_ARC_WINDOW_START, FLIGHT_ARC_WINDOW_END],
        shortFlightDistance: SHORT_FLIGHT_DISTANCE,
        shortFlightArcScale: SHORT_FLIGHT_ARC_SCALE,
      };
    },
    get lookOffsets() {
      return {
        yaw: userAzimuth,
        pitch: userPitch,
        recentering: Boolean(lookRecenter),
        yawClamp: LOOK_YAW_CLAMP,
        pitchClamp: LOOK_PITCH_CLAMP,
        recenterDurationMs: LOOK_RECENTER_DURATION_MS,
        parallaxYaw: PARALLAX_YAW,
        parallaxPitch: PARALLAX_PITCH,
      };
    },
    attachViewer(nextViewer) {
      viewer = nextViewer;
      lastCameraTarget.copy(viewer.center);
      viewer.invalidate();
    },
    subscribeFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    copyCameraTarget(out) {
      return out.copy(lastCameraTarget);
    },
    setCameraOverride(override) {
      cameraOverride = typeof override === 'function' ? override : null;
      viewer?.invalidate();
    },
    setLookLocked(key, locked) {
      if (locked) lookLocks.add(key);
      else lookLocks.delete(key);
      if (lookLocks.size) dragging = false;
    },
    setRenderSuppressed(key, suppressed) {
      if (suppressed) renderLocks.add(key);
      else renderLocks.delete(key);
      if (!renderLocks.size) viewer?.invalidate();
    },
    setSuspended(next) {
      suspended = Boolean(next);
      dragging = false;
      if (suspended) {
        cancelScrollMotion();
      }
      viewer?.invalidate();
    },
    flyTo({ eye, tgt, fov = 55 }) {
      if (!viewer) return;
      cancelScrollMotion();
      browse = {
        started: performance.now(),
        fromEye: viewer.camera.position.clone(),
        fromTarget: lastCameraTarget.clone(),
        fromFov: viewer.camera.fov,
        toEye: new Vector3(...eye),
        toTarget: new Vector3(...tgt),
        toFov: fov,
        flying: true,
      };
      document.body.classList.add('browse-mode');
      activeZoneMode = 'off';
      viewer.zones.setMode('off');
      viewer.invalidate();
    },
    resumeStory: resumeBrowse,
    goToBeat,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      copyGeneration += 1;
      cancelAnimationFrame(frameRaf);
      cancelAnimationFrame(hashRaf);
      unsubscribe();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('wheel', smoothWheel);
      window.removeEventListener('touchstart', handleTouchInput);
      window.removeEventListener('touchmove', handleTouchInput);
      window.removeEventListener('keydown', handleNavigationKey);
      window.removeEventListener('scroll', handleScroll);
      stage.removeEventListener('pointerdown', pointerDown);
      stage.removeEventListener('pointermove', pointerMove);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => stage.removeEventListener(type, pointerEnd));
      frameListeners.clear();
      cancelScrollMotion();
      window.clearTimeout(externalVelocityTimer);
      renderLocks.clear();
      cameraOverride = null;
      rail.replaceChildren();
      copyLayer.replaceChildren();
      pinLayer.replaceChildren();
      document.body.classList.remove('browse-mode', 'document-mode');
      document.documentElement.style.removeProperty('--mobile-sheet-bottom');
    },
  };
}
