import { Color, MathUtils, Vector3 } from 'three/webgpu';

const DEFAULT_HOUR = 11.5;
const MIN_HOUR = 7;
const MAX_HOUR = 21;
const LATITUDE = MathUtils.degToRad(44.857);
const DECLINATION = MathUtils.degToRad(23.44);

function mixColor(a, b, t) {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
}

function daylightAt(hour) {
  // Summer approximation in local civil time: solar noon around 14:00.
  const hourAngle = MathUtils.degToRad((hour - 14) * 15);
  const altitude = Math.asin(
    Math.sin(LATITUDE) * Math.sin(DECLINATION)
      + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(LATITUDE) - Math.tan(DECLINATION) * Math.cos(LATITUDE),
  ) + Math.PI;
  // Compass 45° (north-east) maps to world +X, matching the balcony façade.
  const rotated = azimuth - MathUtils.degToRad(45);
  const direction = new Vector3(
    Math.cos(altitude) * Math.cos(rotated),
    Math.max(0.08, Math.sin(altitude)),
    Math.cos(altitude) * Math.sin(rotated),
  ).normalize();
  const height = MathUtils.clamp(Math.sin(altitude), 0, 1);
  const warmth = MathUtils.smoothstep(height, 0.08, 0.72);
  return {
    direction,
    intensity: 0.45 + height * 4.4,
    height,
    color: mixColor('#ff9d62', '#fff8e6', warmth),
    backdrop: {
      background: mixColor('#d9b296', '#e9e7e2', warmth),
      haze: mixColor('#e9a276', '#dad4c5', warmth),
      sky: mixColor('#6f86ad', '#b6cfe7', warmth),
      skyDeep: mixColor('#293a69', '#527dab', warmth),
    },
  };
}

function formatHour(value, language) {
  const hour = Math.floor(value);
  const minutes = Math.round((value - hour) * 60);
  const date = new Date(Date.UTC(2020, 0, 1, hour, minutes));
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-US', {
    hour: 'numeric',
    minute: minutes ? '2-digit' : undefined,
    timeZone: 'UTC',
  }).format(date);
}

export function mountSun({ viewer, i18n, story }) {
  const root = document.createElement('section');
  root.className = 'sun-scrub';
  root.id = 'sun-scrub';
  root.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('label');
  heading.htmlFor = 'sun-range';
  const output = document.createElement('output');
  output.htmlFor = 'sun-range';
  const header = document.createElement('div');
  header.className = 'sun-scrub-header';
  header.append(heading, output);
  const track = document.createElement('div');
  track.className = 'sun-track';
  const range = document.createElement('input');
  range.id = 'sun-range';
  range.type = 'range';
  range.min = '7';
  range.max = '21';
  range.step = '0.25';
  range.value = String(DEFAULT_HOUR);
  const thumb = document.createElement('span');
  thumb.className = 'sun-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  thumb.innerHTML = `<svg viewBox="0 0 40 40" focusable="false" aria-hidden="true">
    <g class="sun-rays">
      <path d="M20 2v5M20 33v5M2 20h5M33 20h5M7.3 7.3l3.6 3.6M29.1 29.1l3.6 3.6M32.7 7.3l-3.6 3.6M10.9 29.1l-3.6 3.6"/>
    </g>
    <circle class="sun-disc" cx="20" cy="20" r="8.5"/>
    <path class="sun-horizon" d="M5 27.5h30"/>
    <path class="sun-crescent" d="M25.8 10.4a10.5 10.5 0 1 0 3.8 19.3A11.7 11.7 0 0 1 25.8 10.4Z"/>
  </svg>`;
  track.append(range, thumb);
  const scale = document.createElement('div');
  scale.className = 'sun-scale';
  scale.replaceChildren(...[0, 1, 2].map(() => document.createElement('span')));
  root.append(header, track, scale);
  document.body.append(root);

  let selectedHour = DEFAULT_HOUR;
  let active = false;

  function updateControl(hour) {
    const progress = (hour - MIN_HOUR) / (MAX_HOUR - MIN_HOUR);
    const daylight = daylightAt(hour);
    const edge = Math.abs(progress * 2 - 1);
    const color = mixColor('#ff9b68', '#d6ff70', 1 - Math.min(1, edge * 1.22));
    const phase = hour >= 20.75 ? 'night' : (hour >= 18.5 ? 'dusk' : (hour < 9 ? 'dawn' : 'day'));
    root.dataset.sunPhase = phase;
    root.style.setProperty('--sun-progress', progress.toFixed(4));
    root.style.setProperty('--sun-lift', `${Math.round(daylight.height * 14)}px`);
    root.style.setProperty('--sun-color', phase === 'night' ? '#c8cce0' : color);
    output.value = formatHour(hour, i18n.language);
    output.textContent = output.value;
    range.setAttribute('aria-valuetext', output.value);
  }

  function rebuild() {
    heading.textContent = i18n.t('ui.sunTime');
    scale.querySelectorAll('span').forEach((element, index) => {
      element.textContent = i18n.dictionary().ui.sunScale[index];
    });
    updateControl(selectedHour);
  }
  function apply(hour) {
    const daylight = daylightAt(hour);
    updateControl(hour);
    viewer.setDaylight(daylight);
  }
  range.addEventListener('input', () => {
    selectedHour = Number(range.value);
    apply(selectedHour);
  });

  function update(state) {
    const nextActive = !state.docMode && Math.abs(state.value - 4) < 0.52;
    if (nextActive !== active) {
      active = nextActive;
      root.classList.toggle('is-active', active);
      root.setAttribute('aria-hidden', String(!active));
    }
  }

  rebuild();
  const idle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 250));
  idle(() => viewer.prewarm().catch(() => {}));
  const unsubscribeLanguage = i18n.subscribe(rebuild);
  const unsubscribeFrame = story.subscribeFrame(update);
  return () => {
    unsubscribeLanguage();
    unsubscribeFrame();
    viewer.resetDaylight();
    root.remove();
  };
}
